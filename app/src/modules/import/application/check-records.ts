import { DEADLINE_CATEGORIES, LEVELS, PRIORITIES } from "@/modules/deadlines";
import { resolveChoice, type ImportRecord } from "../domain/columns";
import type { ColumnIssue } from "../domain/contacts";
import { deadlineErrorColumn, deadlineKey, normText } from "../domain/deadlines";
import { policyErrorColumn, policyKey } from "../domain/policies";
import { rentErrorColumn } from "../domain/rents";
import { obligationKey, paymentKey, taxErrorColumn, taxPaymentErrorColumn } from "../domain/taxes";
import { addSchemaIssues, findByName, findParty, readDate, type Checked } from "./checked";
import type { ImportLabels, ImportPorts } from "./ports";

type Checker = (record: ImportRecord) => Promise<Checked>;

const required = (issues: ColumnIssue[], column: string, message: string) => issues.push({ column, message });

// ----------------------------------------------------------------------------------------------------------- scadenze

export async function deadlineChecker(ports: ImportPorts, labels: ImportLabels): Promise<Checker> {
  const assets = await ports.existingAssets();
  const existing = new Set((await ports.existingDeadlines()).map((d) => deadlineKey(d.title, d.dueOn, d.assetId)));
  const seen = new Map<string, number>();
  return async (record) => {
    const v = record.values;
    const issues: ColumnIssue[] = [];
    const label = v.title ?? "";

    const category = v.category ? resolveChoice(v.category, DEADLINE_CATEGORIES, labels.categories) : null;
    if (v.category && !category) required(issues, "category", `Categoria non riconosciuta: «${v.category}»`);
    const level = v.level ? resolveChoice(v.level, LEVELS, labels.levels) : null;
    if (v.level && !level) required(issues, "level", `Livello non riconosciuto: «${v.level}»`);
    const priority = v.priority ? resolveChoice(v.priority, PRIORITIES, labels.priorities) : null;
    if (v.priority && !priority) required(issues, "priority", `Priorità non riconosciuta: «${v.priority}»`);

    let assetId: string | undefined;
    if (v.asset) {
      const found = findByName(assets, (a) => a.name, v.asset, {
        missing: `Immobile «${v.asset}» non trovato: inseriscilo o importalo prima`,
        many: `Più immobili si chiamano «${v.asset}»: rinomina uno dei due`,
      });
      if (found.issue) required(issues, "asset", found.issue);
      assetId = found.id;
    }
    const firstDueOn = readDate(v.dueOn, "dueOn", issues);

    const input = {
      title: v.title,
      category: category ?? v.category,
      level: level ?? v.level,
      assetId,
      calc: { type: "manual" },
      firstDueOn,
      priority: priority ?? undefined,
      description: v.notes,
    };
    const checked = ports.validateDeadline(input);
    if (!checked.ok) addSchemaIssues(issues, checked.errors, deadlineErrorColumn);
    if (issues.length > 0) return { label, issues };

    const key = deadlineKey(v.title ?? "", firstDueOn!, assetId);
    if (existing.has(key)) return { label, issues: [], duplicate: "Già presente (stesso titolo, stessa data e stesso immobile)" };
    const earlier = seen.get(key);
    if (earlier !== undefined) return { label, issues: [], duplicate: `Ripetuta nel file: già alla riga ${earlier}` };
    seen.set(key, record.line);
    return { label, issues: [], payload: input };
  };
}

// --------------------------------------------------------------------------------------------------------------- canoni

export async function rentChecker(ports: ImportPorts): Promise<Checker> {
  const lettings = await ports.existingLettings();
  const datesCache = new Map<string, Promise<string[]>>();
  const seen = new Map<string, number>();
  const existingDates = (lettingId: string) => {
    let found = datesCache.get(lettingId);
    if (!found) {
      found = ports.rentDatesOf(lettingId);
      datesCache.set(lettingId, found);
    }
    return found;
  };
  return async (record) => {
    const v = record.values;
    const issues: ColumnIssue[] = [];
    const label = v.letting ?? "";

    let lettingId: string | undefined;
    if (!v.letting) required(issues, "letting", "Locazione: campo obbligatorio");
    else {
      const found = findByName(lettings, (l) => l.title, v.letting, {
        missing: `Locazione «${v.letting}» non trovata: registrala prima in Locazioni`,
        many: `Più locazioni si chiamano «${v.letting}»: rinomina una delle due`,
      });
      if (found.issue) required(issues, "letting", found.issue);
      lettingId = found.id;
    }
    const dueOn = readDate(v.dueOn, "dueOn", issues);
    if (!v.dueOn) required(issues, "dueOn", "Scadenza: campo obbligatorio");
    const paidOn = readDate(v.paidOn, "paidOn", issues);

    const row = ports.validateRent({ dueOn, amount: v.amount });
    if (!row.ok) addSchemaIssues(issues, row.errors, rentErrorColumn);
    const hasPayment = Boolean(v.paid || v.paidOn);
    if (hasPayment) {
      if (!v.paid) required(issues, "paid", "Indica l'importo incassato (oppure togli la data di incasso)");
      else {
        const payment = ports.validateRentPayment({ paid: v.paid, paidOn });
        if (!payment.ok) addSchemaIssues(issues, payment.errors, rentErrorColumn);
      }
    }
    if (issues.length > 0 || !lettingId || !dueOn) return { label, issues };

    if ((await existingDates(lettingId)).includes(dueOn)) return { label, issues: [], duplicate: "Già presente (stessa locazione e stessa scadenza)" };
    const key = `${lettingId}|${dueOn}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) return { label, issues: [], duplicate: `Ripetuta nel file: già alla riga ${earlier}` };
    seen.set(key, record.line);
    return { label, issues: [], payload: { lettingId, dueOn, amount: v.amount, ...(hasPayment ? { paid: v.paid, paidOn } : {}) } };
  };
}

// ----------------------------------------------------------------------------------------------------- voci di tributo

/** Immobile e tipo di tributo di una riga: devono esistere gia'. */
async function taxLookups(ports: ImportPorts) {
  const [assets, types] = await Promise.all([ports.existingAssets(), ports.existingTaxTypes()]);
  return (v: Record<string, string>, issues: ColumnIssue[]) => {
    let assetId: string | undefined;
    let taxTypeId: string | undefined;
    if (!v.asset) required(issues, "asset", "Immobile: campo obbligatorio");
    else {
      const found = findByName(assets, (a) => a.name, v.asset, {
        missing: `Immobile «${v.asset}» non trovato: inseriscilo o importalo prima`,
        many: `Più immobili si chiamano «${v.asset}»: rinomina uno dei due`,
      });
      if (found.issue) required(issues, "asset", found.issue);
      assetId = found.id;
    }
    if (!v.taxType) required(issues, "taxType", "Tipo di tributo: campo obbligatorio");
    else {
      const found = findByName(types, (t) => t.name, v.taxType, {
        missing: `Tipo di tributo «${v.taxType}» non trovato: crealo prima in Tributi (l'importazione non crea i tipi)`,
        many: `Più tipi di tributo si chiamano «${v.taxType}»`,
      });
      if (found.issue) required(issues, "taxType", found.issue);
      taxTypeId = found.id;
    }
    if (!v.year) required(issues, "year", "Anno: campo obbligatorio");
    return { assetId, taxTypeId };
  };
}

export async function taxChecker(ports: ImportPorts): Promise<Checker> {
  const lookup = await taxLookups(ports);
  const existing = new Set((await ports.existingObligations()).map((o) => obligationKey(o.assetId, o.taxTypeId, o.year, o.label)));
  const seen = new Map<string, number>();
  return async (record) => {
    const v = record.values;
    const issues: ColumnIssue[] = [];
    const label = v.asset ?? "";
    const { assetId, taxTypeId } = lookup(v, issues);

    const input = { assetId, taxTypeId, year: v.year, label: v.label, expected: v.expected, note: v.note };
    const checked = ports.validateObligation(input);
    if (!checked.ok) addSchemaIssues(issues, checked.errors, taxErrorColumn);
    if (issues.length > 0 || !checked.ok) return { label, issues };

    const value = checked.value as { year: number; label?: string };
    const key = obligationKey(assetId!, taxTypeId!, value.year, value.label);
    if (existing.has(key)) return { label, issues: [], duplicate: "Già presente (stesso immobile, tributo, anno ed etichetta)" };
    const earlier = seen.get(key);
    if (earlier !== undefined) return { label, issues: [], duplicate: `Ripetuta nel file: già alla riga ${earlier}` };
    seen.set(key, record.line);
    return { label, issues: [], payload: input };
  };
}

// ------------------------------------------------------------------------------------------- pagamenti di tributo

export async function taxPaymentChecker(ports: ImportPorts): Promise<Checker> {
  const lookup = await taxLookups(ports);
  const obligations = new Map((await ports.existingObligations()).map((o) => [obligationKey(o.assetId, o.taxTypeId, o.year, o.label), o]));
  const paymentsCache = new Map<string, Promise<{ paidOn: string; amountCents: number }[]>>();
  const seen = new Map<string, number>();
  return async (record) => {
    const v = record.values;
    const issues: ColumnIssue[] = [];
    const label = v.asset ?? "";
    const { assetId, taxTypeId } = lookup(v, issues);
    const paidOn = readDate(v.paidOn, "paidOn", issues);
    if (!v.paidOn) required(issues, "paidOn", "Data pagamento: campo obbligatorio");

    const checked = ports.validateTaxPayment({ paidOn, amount: v.amount, reference: v.reference });
    if (!checked.ok) addSchemaIssues(issues, checked.errors, taxPaymentErrorColumn);

    let obligationId: string | undefined;
    const year = Number(v.year);
    if (issues.length === 0 && assetId && taxTypeId && Number.isInteger(year)) {
      const obligation = obligations.get(obligationKey(assetId, taxTypeId, year, v.label?.trim() ? v.label.trim() : null));
      if (!obligation) required(issues, "label", "Nessuna voce con questo immobile, tributo, anno ed etichetta: importa o inserisci prima la voce");
      else if (obligation.status === "closed") required(issues, "label", "La voce è chiusa: riaprila per registrare un pagamento");
      else obligationId = obligation.id;
    }
    if (issues.length > 0 || !checked.ok || !obligationId || !paidOn) return { label, issues };

    const amountCents = (checked.value as { amount: number }).amount;
    let payments = paymentsCache.get(obligationId);
    if (!payments) {
      payments = ports.paymentsOf(obligationId);
      paymentsCache.set(obligationId, payments);
    }
    const key = paymentKey(obligationId, paidOn, amountCents);
    if ((await payments).some((p) => paymentKey(obligationId, p.paidOn, p.amountCents) === key)) {
      return { label, issues: [], duplicate: "Già presente (stessa voce, stessa data e stesso importo)" };
    }
    const earlier = seen.get(key);
    if (earlier !== undefined) return { label, issues: [], duplicate: `Ripetuta nel file: già alla riga ${earlier}` };
    seen.set(key, record.line);
    return { label, issues: [], payload: { obligationId, paidOn, amount: v.amount, reference: v.reference } };
  };
}

// ------------------------------------------------------------------------------------------------------------ polizze

export async function policyChecker(ports: ImportPorts): Promise<Checker> {
  const [assets, parties] = await Promise.all([ports.existingAssets(), ports.existingParties()]);
  const existing = new Set((await ports.existingPolicies()).map((p) => policyKey(p.title, p.policyNumber, p.startsOn)));
  const seen = new Map<string, number>();
  return async (record) => {
    const v = record.values;
    const issues: ColumnIssue[] = [];
    const label = v.title ?? "";

    let insurerPartyId: string | undefined;
    if (v.insurer) {
      const found = findParty(parties, v.insurer, "Compagnia");
      if (found.issue) required(issues, "insurer", found.issue);
      insurerPartyId = found.id;
    }
    const assetIds: string[] = [];
    for (const part of (v.assets ?? "").split("|")) {
      const name = normText(part);
      if (name === "") continue;
      const found = findByName(assets, (a) => a.name, part, {
        missing: `Immobile «${part.trim()}» non trovato: inseriscilo o importalo prima`,
        many: `Più immobili si chiamano «${part.trim()}»: rinomina uno dei due`,
      });
      if (found.issue) required(issues, "assets", found.issue);
      else if (found.id && !assetIds.includes(found.id)) assetIds.push(found.id);
    }
    const startsOn = readDate(v.startsOn, "startsOn", issues);
    const endsOn = readDate(v.endsOn, "endsOn", issues);

    const input = { title: v.title, insurerPartyId, policyNumber: v.policyNumber, startsOn, endsOn, premium: v.premium, note: v.notes, assetIds };
    const checked = ports.validatePolicy(input);
    if (!checked.ok) addSchemaIssues(issues, checked.errors, policyErrorColumn);
    if (issues.length > 0) return { label, issues };

    const key = policyKey(v.title ?? "", v.policyNumber, startsOn);
    if (existing.has(key)) return { label, issues: [], duplicate: "Già presente (stesso titolo, stesso numero e stessa data di inizio)" };
    const earlier = seen.get(key);
    if (earlier !== undefined) return { label, issues: [], duplicate: `Ripetuta nel file: già alla riga ${earlier}` };
    seen.set(key, record.line);
    return { label, issues: [], payload: input };
  };
}
