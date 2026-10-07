import { and, asc, desc, eq, exists, ilike, inArray, max, ne, or, sql, type SQL } from "drizzle-orm";
import { document, documentAsset, documentCategory, documentVersion, fileObject } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type {
  Confidentiality,
  DocumentDetail,
  DocumentSummary,
  VerificationStatus,
} from "../domain/document";
import type { DocumentCore, DocumentRepository, ListArgs } from "../application/ports";

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

const versionValues = (v: {
  issuedOn?: string;
  validFrom?: string;
  validTo?: string;
  issuerPartyId?: string;
  verificationStatus: string;
  note?: string;
}) => ({
  issuedOn: v.issuedOn ?? null,
  validFrom: v.validFrom ?? null,
  validTo: v.validTo ?? null,
  issuerPartyId: v.issuerPartyId ?? null,
  verificationStatus: v.verificationStatus,
  note: v.note ?? null,
});

const coreValues = (core: DocumentCore) => ({
  title: core.title,
  categoryId: core.categoryId,
  confidentiality: core.confidentiality,
  notes: core.notes ?? null,
});

/** Le condizioni dell'elenco documenti, condivise tra elenco e conteggio. */
function documentFilters(db: Db, args: ListArgs): SQL[] {
  const conditions: SQL[] = [];
  if (!args.includeArchived) conditions.push(sql`${document.archivedAt} is null`);
  if (args.ids) conditions.push(args.ids.length > 0 ? inArray(document.id, args.ids) : sql`false`);
  if (args.categoryId) conditions.push(eq(document.categoryId, args.categoryId));
  if (args.confidentiality) conditions.push(eq(document.confidentiality, args.confidentiality));
  if (args.verificationStatus) conditions.push(eq(documentVersion.verificationStatus, args.verificationStatus));
  if (args.assetId) {
    conditions.push(
      exists(db.select({ one: sql`1` }).from(documentAsset).where(and(eq(documentAsset.documentId, document.id), eq(documentAsset.assetId, args.assetId)))),
    );
  }
  const query = args.query?.trim();
  if (query) {
    const like = `%${escapeLike(query)}%`;
    conditions.push(
      or(
        ilike(document.title, like),
        exists(
          db
            .select({ one: sql`1` })
            .from(documentVersion)
            .where(
              and(
                eq(documentVersion.documentId, document.id),
                or(
                  ilike(documentVersion.originalFilename, like),
                  sql`${documentVersion.searchVector} @@ websearch_to_tsquery('italian', ${query})`,
                ),
              ),
            ),
        ),
      )!,
    );
  }
  return conditions;
}

export function drizzleDocumentRepository(db: Db): DocumentRepository {
  return {
    async listCategories() {
      return db
        .select({ id: documentCategory.id, code: documentCategory.code, name: documentCategory.name })
        .from(documentCategory)
        .orderBy(asc(documentCategory.position), asc(documentCategory.name));
    },

    async insertFileObject(file) {
      const [row] = await db.insert(fileObject).values(file).returning({ id: fileObject.id });
      return row!.id;
    },

    async insertDocument(core) {
      const [row] = await db.insert(document).values(coreValues(core)).returning({ id: document.id });
      return row!.id;
    },

    async updateDocument(id, core) {
      const rows = await db.update(document).set(coreValues(core)).where(eq(document.id, id)).returning({ id: document.id });
      return rows.length > 0;
    },

    async insertVersion(documentId, v) {
      const [current] = await db
        .select({ n: max(documentVersion.versionNo) })
        .from(documentVersion)
        .where(eq(documentVersion.documentId, documentId));
      const versionNo = (current?.n ?? 0) + 1;
      const [row] = await db
        .insert(documentVersion)
        .values({
          documentId,
          versionNo,
          fileObjectId: v.fileObjectId,
          originalFilename: v.originalFilename,
          extractedText: v.extractedText,
          ...versionValues(v),
        })
        .returning({ id: documentVersion.id });
      // Una nuova versione e' una modifica del documento: aggiorna la data di ultima modifica.
      await db.update(document).set({ updatedAt: new Date() }).where(eq(document.id, documentId));
      return { id: row!.id, versionNo };
    },

    async updateVersion(versionId, v) {
      await db.update(documentVersion).set(versionValues(v)).where(eq(documentVersion.id, versionId));
    },

    async setAssets(documentId, assetIds) {
      await db.delete(documentAsset).where(eq(documentAsset.documentId, documentId));
      const unique = [...new Set(assetIds)];
      if (unique.length > 0) await db.insert(documentAsset).values(unique.map((assetId) => ({ documentId, assetId })));
    },

    async getDetail(id): Promise<DocumentDetail | null> {
      const [doc] = await db.select().from(document).where(eq(document.id, id));
      if (!doc) return null;
      const [versions, assets] = await Promise.all([
        db
          .select({ v: documentVersion, f: fileObject })
          .from(documentVersion)
          .innerJoin(fileObject, eq(fileObject.id, documentVersion.fileObjectId))
          .where(eq(documentVersion.documentId, id))
          .orderBy(desc(documentVersion.versionNo)),
        db.select({ assetId: documentAsset.assetId }).from(documentAsset).where(eq(documentAsset.documentId, id)),
      ]);
      return {
        id: doc.id,
        title: doc.title,
        categoryId: doc.categoryId,
        confidentiality: doc.confidentiality as Confidentiality,
        notes: doc.notes,
        archived: doc.archivedAt !== null,
        assetIds: assets.map((a) => a.assetId),
        versions: versions.map(({ v, f }) => ({
          id: v.id,
          versionNo: v.versionNo,
          originalFilename: v.originalFilename,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          sha256: f.sha256,
          issuedOn: v.issuedOn,
          validFrom: v.validFrom,
          validTo: v.validTo,
          issuerPartyId: v.issuerPartyId,
          verificationStatus: v.verificationStatus as VerificationStatus,
          note: v.note,
          hasText: v.extractedText !== null && v.extractedText.trim() !== "",
          createdAt: v.createdAt,
        })),
      };
    },

    async list(args): Promise<DocumentSummary[]> {
      const latest = db
        .select({ documentId: documentVersion.documentId, maxNo: max(documentVersion.versionNo).as("max_no") })
        .from(documentVersion)
        .groupBy(documentVersion.documentId)
        .as("latest");

      const conditions = documentFilters(db, args);

      const ordered = db
        .select({
          doc: document,
          v: documentVersion,
          mimeType: fileObject.mimeType,
          count: latest.maxNo,
        })
        .from(document)
        .innerJoin(latest, eq(latest.documentId, document.id))
        .innerJoin(documentVersion, and(eq(documentVersion.documentId, document.id), eq(documentVersion.versionNo, latest.maxNo)))
        .innerJoin(fileObject, eq(fileObject.id, documentVersion.fileObjectId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(document.updatedAt), asc(document.title))
        .$dynamic();
      const rows = await (args.limit === undefined ? ordered : ordered.limit(args.limit).offset(args.offset ?? 0));

      return rows.map(({ doc, v, mimeType, count }) => ({
        id: doc.id,
        title: doc.title,
        categoryId: doc.categoryId,
        confidentiality: doc.confidentiality as Confidentiality,
        archived: doc.archivedAt !== null,
        currentVersionId: v.id,
        versionCount: count ?? 1,
        issuedOn: v.issuedOn,
        validTo: v.validTo,
        verificationStatus: v.verificationStatus as VerificationStatus,
        mimeType,
      }));
    },

    async count(args) {
      const latest = db
        .select({ documentId: documentVersion.documentId, maxNo: max(documentVersion.versionNo).as("max_no") })
        .from(documentVersion)
        .groupBy(documentVersion.documentId)
        .as("latest");
      const conditions = documentFilters(db, args);
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(document)
        .innerJoin(latest, eq(latest.documentId, document.id))
        .innerJoin(documentVersion, and(eq(documentVersion.documentId, document.id), eq(documentVersion.versionNo, latest.maxNo)))
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      return row?.n ?? 0;
    },

    async titles(ids) {
      if (ids && ids.length === 0) return new Map();
      const rows = await db.select({ id: document.id, title: document.title }).from(document).where(ids ? inArray(document.id, ids) : undefined);
      return new Map(rows.map((r) => [r.id, r.title]));
    },

    async options(limit) {
      return db
        .select({ id: document.id, title: document.title })
        .from(document)
        .where(sql`${document.archivedAt} is null`)
        .orderBy(desc(document.updatedAt), asc(document.title))
        .limit(limit);
    },

    async setArchived(id, archived) {
      const rows = await db
        .update(document)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(document.id, id))
        .returning({ id: document.id });
      return rows.length > 0;
    },

    async findFile(documentId, versionId) {
      const [row] = await db
        .select({
          storageKey: fileObject.storageKey,
          mimeType: fileObject.mimeType,
          originalFilename: documentVersion.originalFilename,
          sizeBytes: fileObject.sizeBytes,
        })
        .from(documentVersion)
        .innerJoin(fileObject, eq(fileObject.id, documentVersion.fileObjectId))
        .where(and(eq(documentVersion.id, versionId), eq(documentVersion.documentId, documentId)));
      return row ?? null;
    },

    async findBySha256(sha256) {
      const rows = await db
        .select({ id: document.id, title: document.title })
        .from(document)
        .innerJoin(documentVersion, eq(documentVersion.documentId, document.id))
        .innerJoin(fileObject, eq(fileObject.id, documentVersion.fileObjectId))
        .where(eq(fileObject.sha256, sha256));
      return [...new Map(rows.map((r) => [r.id, { documentId: r.id, title: r.title }])).values()];
    },
    async findDuplicates(documentId) {
      const mine = await db
        .select({ sha256: fileObject.sha256, issuerPartyId: documentVersion.issuerPartyId, issuedOn: documentVersion.issuedOn })
        .from(documentVersion)
        .innerJoin(fileObject, eq(fileObject.id, documentVersion.fileObjectId))
        .where(eq(documentVersion.documentId, documentId));
      const [doc] = await db.select({ title: document.title }).from(document).where(eq(document.id, documentId));
      if (!doc || mine.length === 0) return [];

      const hashes = [...new Set(mine.map((m) => m.sha256))];
      const sameFile = await db
        .select({ id: document.id, title: document.title })
        .from(document)
        .innerJoin(documentVersion, eq(documentVersion.documentId, document.id))
        .innerJoin(fileObject, eq(fileObject.id, documentVersion.fileObjectId))
        .where(and(ne(document.id, documentId), inArray(fileObject.sha256, hashes)));

      const result = new Map<string, { documentId: string; title: string; reason: "same_file" | "same_data" }>();
      for (const r of sameFile) result.set(r.id, { documentId: r.id, title: r.title, reason: "same_file" });

      // Stessa terna titolo / emittente / data di emissione (solo se emittente e data sono noti).
      for (const m of mine.filter((x) => x.issuerPartyId && x.issuedOn)) {
        const sameData = await db
          .select({ id: document.id, title: document.title })
          .from(document)
          .innerJoin(documentVersion, eq(documentVersion.documentId, document.id))
          .where(
            and(
              ne(document.id, documentId),
              sql`lower(${document.title}) = lower(${doc.title})`,
              eq(documentVersion.issuerPartyId, m.issuerPartyId!),
              eq(documentVersion.issuedOn, m.issuedOn!),
            ),
          );
        for (const r of sameData) if (!result.has(r.id)) result.set(r.id, { documentId: r.id, title: r.title, reason: "same_data" });
      }
      return [...result.values()];
    },
  };
}
