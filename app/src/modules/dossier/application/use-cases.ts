import { evaluateRules, type DerivedChecklistItem, type DerivedNotice, type Explanation } from "@/modules/rules";
import { canonicalJson } from "@/shared/json";
import { fail, failGeneral, ok, zodIssuesToErrors, type Result } from "@/shared/result";
import { AUTO_PRESENT_FROM, manualItemSchema, noteSchema, statusSchema, summarize, type DossierStatus } from "../domain/dossier";
import type { CategoryRow, DocumentInfo, DossierDeps, DossierReadDeps, EvaluationDiff, ItemRow } from "./ports";

/** Cio' che il motore possiede di una voce derivata: se uguale a quello gia' salvato non si riscrive nulla. */
const derivationOf = (categoryId: string, item: DerivedChecklistItem) =>
  canonicalJson([categoryId, item.title, item.versionId, item.expectedDocumentCategory, item.note, item.explanation]);
const storedDerivation = (row: ItemRow) => canonicalJson([row.categoryId, row.title, row.ruleVersionId, row.expectedDocumentCategory, row.ruleNote, row.explanation]);

/**
 * Valuta le regole su un bene e allinea le voci derivate del dossier.
 * Garanzie (sezione 5.5): il motore crea voci nuove, aggiorna la DERIVAZIONE di quelle esistenti e segna come
 * «non si applica piu'» quelle che la regola non produce piu' — non le cancella mai e non tocca lo stato scelto
 * dal proprietario, la sua nota o i documenti collegati.
 */
export async function evaluateDossier(deps: DossierDeps, assetId: string, asOf: string): Promise<Result<EvaluationDiff>> {
  const context = await deps.others.factsFor(assetId, asOf);
  if (!context) return failGeneral("Bene non trovato o archiviato");

  const evaluation = evaluateRules(await deps.others.activeRules(), context.facts, context.territoryChain, asOf);
  const categories = new Map((await deps.repo.listCategories()).map((c) => [c.code, c.id]));
  const existing = (await deps.repo.itemsForAsset(assetId)).filter((i) => i.origin === "rule");
  const byIdentity = new Map(existing.map((i) => [`${i.ruleKey}/${i.outcomeKey}`, i]));
  const diff: EvaluationDiff = { created: 0, updated: 0, restored: 0, staled: 0, unchanged: 0, skipped: 0 };

  const wanted = new Set<string>();
  for (const item of evaluation.items) {
    const categoryId = categories.get(item.dossierCategory);
    if (!categoryId) {
      diff.skipped += 1; // la categoria e' stata tolta dai dati dopo aver scritto la regola
      continue;
    }
    const identity = `${item.ruleKey}/${item.outcomeKey}`;
    wanted.add(identity);
    const row = byIdentity.get(identity);
    if (!row) {
      await deps.repo.insertDerived(assetId, categoryId, item);
      diff.created += 1;
      continue;
    }
    let changed = false;
    if (derivationOf(categoryId, item) !== storedDerivation(row)) {
      await deps.repo.updateDerivation(row.id, categoryId, item);
      diff.updated += 1;
      changed = true;
    }
    if (row.stale) {
      await deps.repo.setStale(row.id, false);
      diff.restored += 1;
      changed = true;
    }
    if (!changed) diff.unchanged += 1;
  }
  for (const row of existing) {
    if (!wanted.has(`${row.ruleKey}/${row.outcomeKey}`) && !row.stale) {
      await deps.repo.setStale(row.id, true);
      diff.staled += 1;
    }
  }

  await deps.others.syncDeadlines(assetId, evaluation.deadlines, asOf);

  if (diff.created + diff.updated + diff.restored + diff.staled > 0) {
    await deps.audit.record({ action: "dossier.evaluate", entityType: "asset", entityId: assetId, diff: { ...diff } });
  }
  return ok(diff);
}

export async function evaluateAllAssets(deps: DossierDeps, asOf: string): Promise<{ assets: number; changed: number }> {
  const ids = await deps.others.activeAssetIds();
  let changed = 0;
  for (const id of ids) {
    const result = await evaluateDossier(deps, id, asOf);
    if (result.ok && result.value.created + result.value.updated + result.value.restored + result.value.staled > 0) changed += 1;
  }
  return { assets: ids.length, changed };
}

export async function addManualItem(deps: DossierDeps, assetId: string, raw: unknown): Promise<Result<{ id: string }>> {
  const parsed = manualItemSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  if ((await deps.others.assetName(assetId)) === null) return failGeneral("Bene non trovato");
  if (!(await deps.repo.listCategories()).some((c) => c.id === parsed.data.categoryId)) return fail({ categoryId: ["La categoria non esiste"] });
  const id = await deps.repo.insertManual(assetId, parsed.data.categoryId, parsed.data.title, parsed.data.ownerNote);
  await deps.audit.record({ action: "dossier.item.create", entityType: "dossier_item", entityId: id, diff: { assetId, categoryId: parsed.data.categoryId } });
  return ok({ id });
}

export async function setItemStatus(deps: DossierDeps, itemId: string, raw: unknown): Promise<Result<{ id: string }>> {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) return fail({ status: ["Stato non valido"] });
  const item = await deps.repo.getItem(itemId);
  if (!item) return failGeneral("Voce non trovata");
  if (item.status !== parsed.data) {
    await deps.repo.setStatus(itemId, parsed.data);
    await deps.audit.record({ action: "dossier.item.status", entityType: "dossier_item", entityId: itemId, diff: { assetId: item.assetId, from: item.status, to: parsed.data } });
  }
  return ok({ id: itemId });
}

export async function setItemNote(deps: DossierDeps, itemId: string, raw: unknown): Promise<Result<{ id: string }>> {
  const parsed = noteSchema.safeParse(raw);
  if (!parsed.success) return fail({ note: ["Nota troppo lunga (massimo 1000 caratteri)"] });
  const item = await deps.repo.getItem(itemId);
  if (!item) return failGeneral("Voce non trovata");
  await deps.repo.setOwnerNote(itemId, parsed.data ?? null);
  await deps.audit.record({ action: "dossier.item.note", entityType: "dossier_item", entityId: itemId, diff: { assetId: item.assetId, hasNote: parsed.data !== undefined } });
  return ok({ id: itemId });
}

/** Si cancellano solo le voci manuali: una voce derivata si mette «non applicabile», cosi' la scelta resta tracciata. */
export async function removeManualItem(deps: DossierDeps, itemId: string): Promise<Result<{ id: string }>> {
  const item = await deps.repo.getItem(itemId);
  if (!item) return failGeneral("Voce non trovata");
  if (item.origin !== "manual") return failGeneral("Una voce che viene da una regola non si cancella: segnala «non applicabile»");
  await deps.repo.deleteManual(itemId);
  await deps.audit.record({ action: "dossier.item.delete", entityType: "dossier_item", entityId: itemId, diff: { assetId: item.assetId } });
  return ok({ id: itemId });
}

export async function linkDocument(deps: DossierDeps, itemId: string, documentId: string): Promise<Result<{ id: string; status: DossierStatus }>> {
  const item = await deps.repo.getItem(itemId);
  if (!item) return failGeneral("Voce non trovata");
  if ((await deps.others.documents([documentId])).length === 0) return fail({ documentId: ["Il documento non esiste"] });
  if (item.documentIds.includes(documentId)) return ok({ id: itemId, status: item.status });

  await deps.repo.link(itemId, documentId);
  const becomesPresent = AUTO_PRESENT_FROM.includes(item.status);
  if (becomesPresent) await deps.repo.setStatus(itemId, "present");
  await deps.audit.record({
    action: "dossier.item.link",
    entityType: "dossier_item",
    entityId: itemId,
    diff: { assetId: item.assetId, documentId, ...(becomesPresent ? { statusFrom: item.status, statusTo: "present" } : {}) },
  });
  return ok({ id: itemId, status: becomesPresent ? "present" : item.status });
}

export async function unlinkDocument(deps: DossierDeps, itemId: string, documentId: string): Promise<Result<{ id: string }>> {
  const item = await deps.repo.getItem(itemId);
  if (!item) return failGeneral("Voce non trovata");
  await deps.repo.unlink(itemId, documentId);
  await deps.audit.record({ action: "dossier.item.unlink", entityType: "dossier_item", entityId: itemId, diff: { assetId: item.assetId, documentId } });
  return ok({ id: itemId });
}

export type DossierItemView = Omit<ItemRow, "explanation" | "documentIds"> & {
  explanation: Explanation | null;
  documents: (DocumentInfo & { expired: boolean })[];
  expectedDocumentCategoryName: string | null;
  /** La regola che l'ha prodotta non e' ancora stata verificata (bozza o da verificare). */
  unverifiedRule: boolean;
};

export type DossierView = {
  assetName: string;
  categories: { category: CategoryRow; items: DossierItemView[] }[];
  summary: ReturnType<typeof summarize>;
  /** Avvisi calcolati adesso dalle regole (non si salvano). */
  notices: DerivedNotice[];
  staleCount: number;
};

export async function getDossier(deps: DossierReadDeps, assetId: string, asOf: string): Promise<DossierView | null> {
  const assetName = await deps.others.assetName(assetId);
  if (assetName === null) return null;
  const [categories, items, categoryNames, context, rules] = await Promise.all([
    deps.repo.listCategories(),
    deps.repo.itemsForAsset(assetId),
    deps.others.documentCategoryNames(),
    deps.others.factsFor(assetId, asOf),
    deps.others.activeRules(),
  ]);
  const docs = new Map((await deps.others.documents([...new Set(items.flatMap((i) => i.documentIds))])).map((d) => [d.id, d]));

  const views: DossierItemView[] = items.map(({ documentIds, explanation, ...row }) => {
    const exp = (explanation ?? null) as Explanation | null;
    return {
      ...row,
      explanation: exp,
      documents: documentIds.flatMap((id) => {
        const d = docs.get(id);
        return d ? [{ ...d, expired: d.validTo !== null && d.validTo < asOf }] : [];
      }),
      expectedDocumentCategoryName: row.expectedDocumentCategory ? (categoryNames.get(row.expectedDocumentCategory) ?? null) : null,
      unverifiedRule: exp !== null && (exp.verificationStatus === "draft" || exp.verificationStatus === "to_verify"),
    };
  });

  return {
    assetName,
    categories: categories.map((category) => ({ category, items: views.filter((v) => v.categoryId === category.id) })),
    summary: summarize(views),
    notices: context ? evaluateRules(rules, context.facts, context.territoryChain, asOf).notices : [],
    staleCount: views.filter((v) => v.stale).length,
  };
}
