import { changedKeys } from "@/shared/changed";
import { fail, failGeneral, ok, parseInput, type Result } from "@/shared/result";
import { DEFAULT_REVIEW_MONTHS, classifyReview, type ReviewState } from "../domain/review";
import { formTemplateSchema, type FormTemplateInput } from "../domain/form-template";
import type { FormTemplateDeps, FormTemplateReadDeps, FormTemplateRow } from "./ports";

type Id = Result<{ id: string }>;

const data = (v: FormTemplateInput): Omit<FormTemplateRow, "id" | "archived"> => ({
  officePartyId: v.officePartyId,
  name: v.name,
  checklist: v.checklist,
  source: v.source ?? null,
  verifiedOn: v.verifiedOn ?? null,
  verificationStatus: v.verificationStatus,
  note: v.note ?? null,
});

export async function createFormTemplate(deps: FormTemplateDeps, raw: unknown): Promise<Id> {
  const p = parseInput(formTemplateSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.others.officeName(p.value.officePartyId))) return fail({ officePartyId: ["Il contatto non è un ufficio della rubrica"] });
  const id = await deps.repo.insert({ ...data(p.value), archived: false });
  await deps.audit.record({ action: "office.form.create", entityType: "office_form_template", entityId: id, diff: { items: p.value.checklist.length, status: p.value.verificationStatus, hasSource: Boolean(p.value.source) } });
  return ok({ id });
}

export async function updateFormTemplate(deps: FormTemplateDeps, id: string, raw: unknown): Promise<Id> {
  const current = await deps.repo.get(id);
  if (!current) return failGeneral("Modulo non trovato");
  const p = parseInput(formTemplateSchema, raw);
  if (!p.ok) return p;
  if (p.value.officePartyId !== current.officePartyId && !(await deps.others.officeName(p.value.officePartyId))) return fail({ officePartyId: ["Il contatto non è un ufficio della rubrica"] });
  const next = data(p.value);
  await deps.repo.update(id, next);
  await deps.audit.record({ action: "office.form.update", entityType: "office_form_template", entityId: id, diff: { changed: changedKeys(current, { ...current, ...next }), items: p.value.checklist.length } });
  return ok({ id });
}

export async function setFormTemplateArchived(deps: FormTemplateDeps, id: string, archived: boolean): Promise<Id> {
  const current = await deps.repo.get(id);
  if (!current) return failGeneral("Modulo non trovato");
  await deps.repo.update(id, { archived });
  await deps.audit.record({ action: archived ? "office.form.archive" : "office.form.restore", entityType: "office_form_template", entityId: id, diff: {} });
  return ok({ id });
}

export type FormTemplateItem = FormTemplateRow & {
  /** Verificato / non verificato e quanto e' vecchio l'ultimo controllo (stesse regole del controllo delle fonti). */
  state: ReviewState;
};

/** I moduli di un ufficio (non archiviati), con lo stato di verifica rispetto a oggi. Nessun giudizio sul contenuto. */
export async function listFormTemplates(deps: FormTemplateReadDeps, args: { officePartyId?: string; includeArchived?: boolean }, today: string, maxAgeMonths = DEFAULT_REVIEW_MONTHS): Promise<FormTemplateItem[]> {
  const rows = await deps.repo.list({ officePartyId: args.officePartyId, includeArchived: args.includeArchived ?? false });
  return rows.map((r) => ({ ...r, state: classifyReview({ status: r.verificationStatus, lastCheckedOn: r.verifiedOn, today, maxAgeMonths }) }));
}
