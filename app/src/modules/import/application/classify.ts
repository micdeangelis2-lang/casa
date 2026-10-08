import { ASSET_KINDS, RIGHT_TYPES, USE_TYPES } from "@/modules/assets";
import { PARTY_ROLES } from "@/modules/directory";
import { normalizeHeader, parseCsv } from "../domain/csv-reader";
import { exampleColumn, isExampleRow, mapColumns, resolveChoice, type ImportColumn, type ImportKind, type ImportRecord } from "../domain/columns";
import { CONTACT_COLUMNS, contactDuplicateReason, contactKeys, parseRoles, type ColumnIssue } from "../domain/contacts";
import { ASSET_COLUMNS, assetErrorColumn, assetKey } from "../domain/assets";
import { parseQuota } from "../domain/quota";
import { DEADLINE_COLUMNS } from "../domain/deadlines";
import { POLICY_COLUMNS } from "../domain/policies";
import { RENT_COLUMNS } from "../domain/rents";
import { TAX_COLUMNS, TAX_PAYMENT_COLUMNS } from "../domain/taxes";
import { findParty, toIssues, type Checked } from "./checked";
import { deadlineChecker, policyChecker, rentChecker, taxChecker, taxPaymentChecker } from "./check-records";
import type { ImportFailure, ImportLabels, ImportPorts, RowOutcome } from "./ports";

const COLUMNS: Record<ImportKind, readonly ImportColumn[]> = {
  contacts: CONTACT_COLUMNS,
  assets: ASSET_COLUMNS,
  deadlines: DEADLINE_COLUMNS,
  rents: RENT_COLUMNS,
  taxes: TAX_COLUMNS,
  taxPayments: TAX_PAYMENT_COLUMNS,
  policies: POLICY_COLUMNS,
};

export const columnsFor = (kind: ImportKind): readonly ImportColumn[] => COLUMNS[kind];

/** Una riga classificata, con il dato pronto per la scrittura se e' «pronta». */
export type ClassifiedRow = RowOutcome & { payload?: unknown };

export type Classified = { ok: true; rows: ClassifiedRow[]; ignoredHeaders: string[] } | ImportFailure;

async function contactChecker(ports: ImportPorts, labels: ImportLabels) {
  const existing = (await ports.existingParties()).map((p) => contactKeys(p));
  const seen: { keys: ReturnType<typeof contactKeys>; line: number }[] = [];
  return async (record: ImportRecord): Promise<Checked> => {
    const v = record.values;
    const { roles, issues } = parseRoles(v.roles ?? "", PARTY_ROLES, labels.roles);
    const input = {
      displayName: v.displayName,
      roles,
      taxCode: v.taxCode,
      email: v.email,
      pec: v.pec,
      phone: v.phone,
      address: v.address,
      notes: v.notes,
    };
    const checked = ports.validateParty(input);
    const label = v.displayName ?? "";
    if (!checked.ok) issues.push(...toIssues(checked.errors, (p) => p.split(".")[0] ?? "_"));
    if (issues.length > 0 || !checked.ok) return { label, issues };

    const keys = contactKeys(checked.value as { displayName: string; taxCode?: string; email?: string });
    for (const other of existing) {
      const why = contactDuplicateReason(keys, other);
      if (why) return { label, issues: [], duplicate: `Già presente in rubrica (${why})` };
    }
    for (const other of seen) {
      const why = contactDuplicateReason(keys, other.keys);
      if (why) return { label, issues: [], duplicate: `Ripetuta nel file: già alla riga ${other.line} (${why})` };
    }
    seen.push({ keys, line: record.line });
    return { label, issues: [], payload: input };
  };
}

async function assetChecker(ports: ImportPorts, labels: ImportLabels) {
  const existing = new Set((await ports.existingAssets()).map((a) => assetKey(a.name, a.address)));
  const seen = new Map<string, number>();
  const parties = await ports.existingParties();
  const municipalityCache = new Map<string, Promise<{ id: string; name: string; label: string }[]>>();

  const findMunicipality = async (name: string, sigla: string): Promise<{ id?: string; issue?: string }> => {
    const norm = normalizeHeader(name);
    let found = municipalityCache.get(norm);
    if (!found) {
      found = ports.findMunicipalities(name).then((list) => list.filter((m) => normalizeHeader(m.name) === norm));
      municipalityCache.set(norm, found);
    }
    let list = await found;
    if (sigla) list = list.filter((m) => m.label.includes(`(${sigla.toUpperCase()})`));
    if (list.length === 0) {
      return { issue: `Comune «${name}»${sigla ? ` (${sigla.toUpperCase()})` : ""} non trovato tra i territori importati` };
    }
    if (list.length > 1) return { issue: `Più Comuni si chiamano «${name}»: indica la sigla della Provincia` };
    return { id: list[0]!.id };
  };

  return async (record: ImportRecord): Promise<Checked> => {
    const v = record.values;
    const issues: ColumnIssue[] = [];
    const label = v.name ?? "";

    const kind = v.kind ? resolveChoice(v.kind, ASSET_KINDS, labels.kinds) : null;
    if (v.kind && !kind) issues.push({ column: "kind", message: `Tipo non riconosciuto: «${v.kind}»` });
    const useType = v.useType ? resolveChoice(v.useType, USE_TYPES, labels.uses) : null;
    if (v.useType && !useType) issues.push({ column: "useType", message: `Uso non riconosciuto: «${v.useType}»` });

    let territoryId = "";
    if (!v.municipality) issues.push({ column: "municipality", message: "Comune: campo obbligatorio" });
    else {
      const m = await findMunicipality(v.municipality, (v.province ?? "").trim());
      if (m.issue) issues.push({ column: "municipality", message: m.issue });
      else territoryId = m.id!;
    }

    const rights: unknown[] = [];
    if (v.holder) {
      const holder = findParty(parties, v.holder, "Titolare");
      if (holder.issue) issues.push({ column: "holder", message: holder.issue });
      const quota = v.quota ? parseQuota(v.quota) : null;
      if (!v.quota) issues.push({ column: "quota", message: "Indica la quota del titolare (es. 50% oppure 1/2)" });
      else if (!quota) issues.push({ column: "quota", message: "Quota non valida: usa una percentuale (50%) o una frazione (1/2)" });
      const right = v.rightType ? resolveChoice(v.rightType, RIGHT_TYPES, labels.rights) : null;
      if (!v.rightType) issues.push({ column: "rightType", message: "Indica il diritto del titolare" });
      else if (!right) issues.push({ column: "rightType", message: `Diritto non riconosciuto: «${v.rightType}»` });
      if (holder.id && quota && right) {
        rights.push({ holder: { type: "party", partyId: holder.id }, rightType: right, quotaNumerator: quota.numerator, quotaDenominator: quota.denominator });
      }
    } else if (v.quota || v.rightType) {
      issues.push({ column: "holder", message: "Quota e diritto richiedono il titolare" });
    }

    const hasCadastral = [v.sheet, v.parcel, v.subunit, v.cadastralCategory, v.income].some(Boolean);
    const cadastral = hasCadastral
      ? [{ sheet: v.sheet, parcel: v.parcel, subunit: v.subunit, cadastralCategory: v.cadastralCategory, income: v.income }]
      : [];

    const input = {
      kind: kind ?? v.kind,
      name: v.name,
      territoryId: territoryId || undefined,
      locality: v.locality,
      address: v.address,
      postalCode: v.postalCode,
      useType: useType ?? undefined,
      notes: v.notes,
      rights,
      cadastral,
    };
    const checked = ports.validateAsset(input);
    if (!checked.ok) {
      for (const issue of toIssues(checked.errors, assetErrorColumn)) {
        // Gli errori sui campi gia' segnalati sopra (tipo, uso, Comune, titolare) non si ripetono.
        if (!issues.some((i) => i.column === issue.column)) issues.push(issue);
      }
    }
    if (issues.length > 0) return { label, issues };

    const key = assetKey(v.name ?? "", v.address);
    if (existing.has(key)) return { label, issues: [], duplicate: "Già presente (stessa denominazione e stesso indirizzo)" };
    const earlier = seen.get(key);
    if (earlier !== undefined) return { label, issues: [], duplicate: `Ripetuta nel file: già alla riga ${earlier}` };
    seen.set(key, record.line);
    return { label, issues: [], payload: { ...input, territoryId } };
  };
}

const CHECKERS: Record<ImportKind, (ports: ImportPorts, labels: ImportLabels) => Promise<(record: ImportRecord) => Promise<Checked>>> = {
  contacts: contactChecker,
  assets: assetChecker,
  deadlines: deadlineChecker,
  rents: rentChecker,
  taxes: taxChecker,
  taxPayments: taxPaymentChecker,
  policies: policyChecker,
};

/** Legge il file e classifica ogni riga («pronta», «già presente», «errore»). Non scrive nulla. */
export async function classifyFile(kind: ImportKind, text: string, ports: ImportPorts, labels: ImportLabels): Promise<Classified> {
  const parsed = parseCsv(text);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const columns = columnsFor(kind);
  const mapped = mapColumns(parsed, columns);
  if (!mapped.ok) return mapped;

  const check = await CHECKERS[kind](ports, labels);
  const markerKey = exampleColumn(columns)?.key ?? "";
  const rows: ClassifiedRow[] = [];
  for (const record of mapped.records) {
    if (record.columnCountError) {
      rows.push({ line: record.line, status: "error", label: record.values[markerKey] ?? "", message: record.columnCountError });
      continue;
    }
    if (isExampleRow(record.values, columns)) {
      rows.push({ line: record.line, status: "skipped", label: record.values[markerKey] ?? "", message: "Riga di esempio del modello: non viene importata" });
      continue;
    }
    const result = await check(record);
    const first = result.issues[0];
    if (first) {
      const header = columns.find((c) => c.key === first.column)?.header;
      rows.push({
        line: record.line,
        status: "error",
        label: result.label,
        message: result.issues.length > 1 ? `${first.message} (e altri ${result.issues.length - 1} problemi)` : first.message,
        ...(header ? { column: header } : {}),
      });
    } else if (result.duplicate) rows.push({ line: record.line, status: "duplicate", label: result.label, message: result.duplicate });
    else rows.push({ line: record.line, status: "ready", label: result.label, payload: result.payload });
  }
  return { ok: true, rows, ignoredHeaders: mapped.ignoredHeaders };
}
