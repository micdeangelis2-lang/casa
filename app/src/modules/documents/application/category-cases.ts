import type { AuditRecorder } from "@/platform/audit";
import { fail, failGeneral, ok, parseInput, type Result } from "@/shared/result";
import { categoryCodeFrom, categoryNameSchema, PROTECTED_CATEGORY_CODES, type DocumentCategoryUsage } from "../domain/category";

export type CategoryRecord = { id: string; code: string; name: string; parentId: string | null; position: number };

export interface CategoryRepository {
  /** Tutte le categorie, in ordine di posizione e nome. */
  all(): Promise<CategoryRecord[]>;
  insert(d: { code: string; name: string; position: number }): Promise<string>;
  rename(id: string, name: string): Promise<void>;
  setPosition(id: string, position: number): Promise<void>;
  remove(id: string): Promise<void>;
  /** Documenti (anche archiviati) per categoria. */
  documentCounts(): Promise<Map<string, number>>;
  /** Voci del dossier e versioni di regole che richiamano ogni codice di categoria documentale. */
  referenceCounts(): Promise<Map<string, number>>;
}

export type CategoryDeps = { repo: CategoryRepository; audit: AuditRecorder };

type Id = Result<{ id: string }>;
const STEP = 10;
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("it") === b.trim().toLocaleLowerCase("it");
const isProtected = (code: string) => (PROTECTED_CATEGORY_CODES as readonly string[]).includes(code);

/** Aggiunge una categoria in fondo all'elenco; il codice si ricava dal nome e resta quello. */
export async function addCategory(deps: CategoryDeps, raw: unknown): Promise<Id> {
  const p = parseInput(categoryNameSchema, raw);
  if (!p.ok) return p;
  const { name } = p.value;
  const all = await deps.repo.all();
  if (all.some((c) => sameName(c.name, name))) return fail({ name: ["Esiste già una categoria con questo nome"] });
  const codes = new Set(all.map((c) => c.code));
  const base = categoryCodeFrom(name);
  let code = base;
  for (let n = 2; codes.has(code); n += 1) code = `${base}_${n}`;
  const position = all.reduce((m, c) => Math.max(m, c.position), 0) + STEP;
  const id = await deps.repo.insert({ code, name, position });
  await deps.audit.record({ action: "documents.category.add", entityType: "document_category", entityId: id, diff: {} });
  return ok({ id });
}

/** Cambia il nome (non il codice). */
export async function renameCategory(deps: CategoryDeps, id: string, raw: unknown): Promise<Id> {
  const p = parseInput(categoryNameSchema, raw);
  if (!p.ok) return p;
  const { name } = p.value;
  const all = await deps.repo.all();
  if (!all.some((c) => c.id === id)) return failGeneral("Categoria non trovata");
  if (all.some((c) => c.id !== id && sameName(c.name, name))) return fail({ name: ["Esiste già una categoria con questo nome"] });
  await deps.repo.rename(id, name);
  await deps.audit.record({ action: "documents.category.rename", entityType: "document_category", entityId: id, diff: { changed: ["name"] } });
  return ok({ id });
}

/** Sposta la categoria di un posto verso l'alto o verso il basso e rinumera l'elenco. */
export async function moveCategory(deps: CategoryDeps, id: string, direction: string): Promise<Id> {
  if (direction !== "up" && direction !== "down") return failGeneral("Direzione non valida");
  const all = await deps.repo.all();
  const index = all.findIndex((c) => c.id === id);
  if (index < 0) return failGeneral("Categoria non trovata");
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= all.length) return ok({ id });
  const order = [...all];
  [order[index], order[target]] = [order[target]!, order[index]!];
  let moved = 0;
  for (const [i, c] of order.entries()) {
    const position = (i + 1) * STEP;
    if (c.position !== position) {
      await deps.repo.setPosition(c.id, position);
      moved += 1;
    }
  }
  await deps.audit.record({ action: "documents.category.move", entityType: "document_category", entityId: id, diff: { direction, positionsChanged: moved } });
  return ok({ id });
}

/** Rimuove una categoria solo se non e' seminata, non ha documenti, non ha sottocategorie e nessuna regola o voce del dossier la richiama. */
export async function removeCategory(deps: CategoryDeps, id: string): Promise<Id> {
  const usage = (await listCategoryUsage(deps)).find((c) => c.id === id);
  if (!usage) return failGeneral("Categoria non trovata");
  if (usage.protected) return failGeneral("Questa categoria è usata dalle schede e dalle regole dell'app: si può rinominare, non rimuovere");
  if (usage.documents > 0) return failGeneral("La categoria ha dei documenti: spostali in un'altra categoria prima di rimuoverla");
  if (usage.children > 0) return failGeneral("La categoria ha delle sottocategorie");
  if (usage.references > 0) return failGeneral("La categoria è richiamata da regole o da voci del dossier");
  await deps.repo.remove(id);
  await deps.audit.record({ action: "documents.category.remove", entityType: "document_category", entityId: id, diff: {} });
  return ok({ id });
}

/** Le categorie con gli usi che impediscono di rimuoverle. */
export async function listCategoryUsage(deps: Pick<CategoryDeps, "repo">): Promise<DocumentCategoryUsage[]> {
  const [all, documents, references] = await Promise.all([deps.repo.all(), deps.repo.documentCounts(), deps.repo.referenceCounts()]);
  return all.map((c) => {
    const row = {
      id: c.id,
      name: c.name,
      position: c.position,
      documents: documents.get(c.id) ?? 0,
      children: all.filter((o) => o.parentId === c.id).length,
      references: references.get(c.code) ?? 0,
      protected: isProtected(c.code),
    };
    return { ...row, removable: !row.protected && row.documents === 0 && row.children === 0 && row.references === 0 };
  });
}
