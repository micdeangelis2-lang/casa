import { addDays, yearOf } from "@/shared/dates";
import { sameJson } from "@/shared/json";
import { occurrencesBetween, shiftToBusinessDay } from "@/shared/calc";
import { fail, failGeneral, ok, parseInput, zodIssuesToErrors, type FieldErrors, type Result } from "@/shared/result";
import { holidaySet } from "../domain/holidays";
import {
  completionSchema,
  DEFAULT_LEAD_DAYS,
  deadlineInputSchema,
  isOverdue,
  notificationText,
  pendingStep,
  type DeadlineInput,
  type Priority,
} from "../domain/deadline";
import type {
  DeadlineDeps,
  DeadlineReadDeps,
  DeadlineRow,
  DerivedDeadline,
  MailPort,
  NewDeadline,
  OccurrenceFilter,
  OccurrenceRow,
  OccurrenceView,
  ProofRow,
} from "./ports";

/** Le date si calcolano da oggi in avanti: non si inventano ritardi per date passate prima che la scadenza esistesse. */
const HORIZON_DAYS = 400;
const STOP_ESCALATION_AFTER_DAYS = 365;

const toNew = (input: DeadlineInput): NewDeadline => ({
  title: input.title,
  description: input.description ?? null,
  category: input.category,
  level: input.level,
  legalBasis: input.legalBasis ?? null,
  assetId: input.assetId ?? null,
  responsiblePartyId: input.responsiblePartyId ?? null,
  professionalPartyId: input.professionalPartyId ?? null,
  matterId: input.matterId ?? null,
  calc: input.calc,
  shiftToBusinessDay: input.shiftToBusinessDay,
  priority: input.priority,
  consequences: input.consequences ?? null,
  requiredDocuments: input.requiredDocuments ?? null,
  leadDays: input.leadDays ?? DEFAULT_LEAD_DAYS[input.priority],
  proofRequired: input.proofRequired,
  origin: "manual",
  ruleKey: null,
  outcomeKey: null,
  ruleVersionId: null,
  explanation: null,
});

async function checkReferences(deps: DeadlineDeps, input: { assetId?: string; responsiblePartyId?: string; professionalPartyId?: string; matterId?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (input.assetId && !(await deps.others.assetNames()).has(input.assetId)) errors.assetId = ["L'immobile non esiste più"];
  const parties = await deps.others.partyNames();
  if (input.responsiblePartyId && !parties.has(input.responsiblePartyId)) errors.responsiblePartyId = ["Il contatto non esiste più nella rubrica"];
  if (input.professionalPartyId && !parties.has(input.professionalPartyId)) errors.professionalPartyId = ["Il contatto non esiste più nella rubrica"];
  if (input.matterId && !(await deps.others.matterIds()).has(input.matterId)) errors.matterId = ["La pratica non esiste più"];
  return errors;
}

/**
 * Calcola le date di una scadenza da oggi in avanti e le inserisce (idempotente). Se la regola di calcolo e' cambiata,
 * annulla le date FUTURE ancora aperte che non produce piu'; le date passate non si toccano (le decide il proprietario).
 */
export async function materialize(deps: DeadlineDeps, deadline: DeadlineRow, today: string): Promise<{ created: number; cancelled: number }> {
  if (deadline.calc.type === "manual" || deadline.archived) return { created: 0, cancelled: 0 };
  const info = deadline.assetId ? await deps.others.assetInfo(deadline.assetId) : null;
  if (deadline.assetId && !info) return { created: 0, cancelled: 0 };
  const to = addDays(today, HORIZON_DAYS);

  let dates = occurrencesBetween(deadline.calc, { attributes: info?.attributes ?? {} }, today, to);
  if (deadline.shiftToBusinessDay) {
    const holidays = holidaySet(yearOf(today), yearOf(to) + 1, await deps.repo.holidayRulesFor(info?.territoryChain ?? []));
    dates = dates.map((d) => shiftToBusinessDay(d, holidays));
  }
  const unique = [...new Set(dates)].sort();
  let created = 0;
  for (const dueOn of unique) if (await deps.repo.insertOccurrence(deadline.id, dueOn)) created += 1;
  const cancelled = await deps.repo.cancelOpenAfter(deadline.id, today, unique);
  return { created, cancelled };
}

/** Convalida a secco dei campi di una scadenza (le stesse regole di `createDeadline`, senza consultare il database e senza scrivere). */
export const validateDeadline = (input: unknown): Result<DeadlineInput> => parseInput(deadlineInputSchema, input);

export async function createDeadline(deps: DeadlineDeps, raw: unknown, today: string): Promise<Result<{ id: string }>> {
  const parsed = deadlineInputSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const errors = await checkReferences(deps, parsed.data);
  if (Object.keys(errors).length > 0) return fail(errors);

  const data = toNew(parsed.data);
  const id = await deps.repo.insertDeadline(data);
  if (parsed.data.calc.type === "manual") await deps.repo.insertOccurrence(id, parsed.data.firstDueOn!);
  else await materialize(deps, { ...data, id, stale: false, archived: false }, today);
  await deps.audit.record({
    action: "deadline.create",
    entityType: "deadline",
    entityId: id,
    diff: { category: data.category, level: data.level, calc: data.calc.type, assetId: data.assetId },
  });
  return ok({ id });
}

export async function updateDeadline(deps: DeadlineDeps, id: string, raw: unknown, today: string): Promise<Result<{ id: string }>> {
  const current = await deps.repo.getDeadline(id);
  if (!current) return failGeneral("Scadenza non trovata");
  if (current.origin === "rule") return failGeneral("Questa scadenza viene da una regola: cambiala dalla regola");
  const parsed = deadlineInputSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const errors = await checkReferences(deps, parsed.data);
  if (Object.keys(errors).length > 0) return fail(errors);

  const data = toNew(parsed.data);
  const changed = (["title", "description", "category", "level", "legalBasis", "assetId", "responsiblePartyId", "professionalPartyId", "matterId", "calc", "shiftToBusinessDay", "priority", "consequences", "requiredDocuments", "leadDays", "proofRequired"] as const).filter(
    (f) => JSON.stringify(data[f]) !== JSON.stringify(current[f]),
  );
  await deps.repo.updateDeadline(id, data);
  await materialize(deps, { ...data, id, stale: current.stale, archived: current.archived }, today);
  await deps.audit.record({ action: "deadline.update", entityType: "deadline", entityId: id, diff: { changed } });
  return ok({ id });
}

/** Una scadenza da regola: titolo, calcolo e base sono della regola; responsabile, professionista, priorita' e preavvisi sono del proprietario. */
export async function updateOwnerFields(deps: DeadlineDeps, id: string, raw: { responsiblePartyId?: string; professionalPartyId?: string; matterId?: string; priority?: Priority; leadDays?: number[] }): Promise<Result<{ id: string }>> {
  const current = await deps.repo.getDeadline(id);
  if (!current) return failGeneral("Scadenza non trovata");
  const errors = await checkReferences(deps, raw);
  if (Object.keys(errors).length > 0) return fail(errors);
  await deps.repo.updateDeadline(id, {
    responsiblePartyId: raw.responsiblePartyId ?? null,
    professionalPartyId: raw.professionalPartyId ?? null,
    matterId: raw.matterId ?? null,
    priority: raw.priority ?? current.priority,
    leadDays: raw.leadDays ?? current.leadDays,
  });
  await deps.audit.record({ action: "deadline.update", entityType: "deadline", entityId: id, diff: { changed: ["responsiblePartyId", "professionalPartyId", "matterId", "priority", "leadDays"] } });
  return ok({ id });
}

export async function setDeadlineArchived(deps: DeadlineDeps, id: string, archived: boolean): Promise<Result<{ id: string }>> {
  if (!(await deps.repo.setArchived(id, archived))) return failGeneral("Scadenza non trovata");
  await deps.audit.record({ action: archived ? "deadline.archive" : "deadline.restore", entityType: "deadline", entityId: id, diff: {} });
  return ok({ id });
}


/**
 * Allinea le scadenze derivate dalle regole per un bene (come per le voci del dossier): crea le nuove, aggiorna la derivazione
 * di quelle esistenti, segna «da rivedere» quelle che le regole non producono piu'. Non cancella nulla e non tocca
 * responsabile, professionista, preavvisi, stato e prove scelti dal proprietario.
 */
export async function syncDerivedDeadlines(deps: DeadlineDeps, assetId: string, derived: DerivedDeadline[], today: string): Promise<{ created: number; updated: number; staled: number; restored: number; occurrences: number }> {
  const existing = new Map((await deps.repo.derivedFor(assetId)).map((d) => [`${d.ruleKey}/${d.outcomeKey}`, d]));
  const counts = { created: 0, updated: 0, staled: 0, restored: 0, occurrences: 0 };
  const wanted = new Set<string>();

  for (const item of derived) {
    const identity = `${item.ruleKey}/${item.outcomeKey}`;
    wanted.add(identity);
    const fields = {
      title: item.title,
      category: item.category,
      level: item.level,
      legalBasis: item.legalBasis,
      calc: item.calc,
      shiftToBusinessDay: item.shiftToBusinessDay,
      consequences: item.consequences,
      requiredDocuments: item.requiredDocuments,
      proofRequired: item.proofRequired,
      ruleVersionId: item.versionId,
      explanation: item.explanation,
    };
    const row = existing.get(identity);
    let current: DeadlineRow;
    if (!row) {
      const data: NewDeadline = {
        ...fields,
        description: null,
        assetId,
        responsiblePartyId: null,
        professionalPartyId: null,
        matterId: null,
        priority: item.priority,
        leadDays: DEFAULT_LEAD_DAYS[item.priority],
        origin: "rule",
        ruleKey: item.ruleKey,
        outcomeKey: item.outcomeKey,
      };
      const id = await deps.repo.insertDeadline(data);
      current = { ...data, id, stale: false, archived: false };
      counts.created += 1;
    } else {
      current = row;
      const changed = (Object.keys(fields) as (keyof typeof fields)[]).some((k) => !sameJson(fields[k], row[k]));
      if (changed) {
        await deps.repo.updateDeadline(row.id, fields);
        current = { ...row, ...fields };
        counts.updated += 1;
      }
      if (row.stale) {
        await deps.repo.updateDeadline(row.id, { stale: false });
        current = { ...current, stale: false };
        counts.restored += 1;
      }
    }
    counts.occurrences += (await materialize(deps, current, today)).created;
  }
  for (const [identity, row] of existing) {
    if (!wanted.has(identity) && !row.stale) {
      await deps.repo.updateDeadline(row.id, { stale: true });
      counts.staled += 1;
    }
  }
  if (counts.created + counts.updated + counts.staled + counts.restored > 0) {
    await deps.audit.record({ action: "deadline.sync", entityType: "asset", entityId: assetId, diff: { ...counts } });
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------------- date (occorrenze)

async function loadOccurrence(deps: DeadlineDeps, occurrenceId: string) {
  const occurrence = await deps.repo.getOccurrence(occurrenceId);
  if (!occurrence) return null;
  const deadline = await deps.repo.getDeadline(occurrence.deadlineId);
  return deadline ? { occurrence, deadline } : null;
}

export async function addOccurrence(deps: DeadlineDeps, deadlineId: string, dueOn: string): Promise<Result<{ id: string }>> {
  const deadline = await deps.repo.getDeadline(deadlineId);
  if (!deadline) return failGeneral("Scadenza non trovata");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return fail({ dueOn: ["Data non valida"] });
  const id = await deps.repo.insertOccurrence(deadlineId, dueOn);
  if (!id) return fail({ dueOn: ["Questa data c'è già"] });
  await deps.audit.record({ action: "deadline.occurrence.add", entityType: "deadline", entityId: deadlineId, diff: { dueOn } });
  return ok({ id });
}

/**
 * Chiude una data. Se la scadenza richiede una prova, serve un documento o un riferimento. Chi la attesta (proprietario,
 * verifica automatica, professionista) e' registrato e mostrato: sono tre cose diverse.
 */
export async function completeOccurrence(deps: DeadlineDeps, occurrenceId: string, raw: unknown, today: string): Promise<Result<{ id: string }>> {
  const loaded = await loadOccurrence(deps, occurrenceId);
  if (!loaded) return failGeneral("Data non trovata");
  const parsed = completionSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const { occurrence, deadline } = loaded;
  if (occurrence.status === "done") return failGeneral("Questa data è già completata");

  const c = parsed.data;
  if (deadline.proofRequired && !c.documentId && !c.reference) return fail({ reference: ["Per chiudere questa scadenza serve una prova: un documento o un riferimento"] });
  if (c.documentId && !(await deps.others.documentTitles([c.documentId])).has(c.documentId)) return fail({ documentId: ["Il documento non esiste"] });
  if (c.completionKind === "professional_validated" && !deadline.professionalPartyId) {
    return fail({ completionKind: ["Per «validata da un professionista» indica prima il professionista nella scadenza"] });
  }

  await deps.repo.updateOccurrence(occurrenceId, { status: "done", completedOn: c.completedOn ?? today, completionKind: c.completionKind, note: c.note ?? occurrence.note });
  if (c.documentId || c.reference) await deps.repo.addProof(occurrenceId, { documentId: c.documentId, reference: c.reference });
  await deps.audit.record({
    action: "deadline.occurrence.complete",
    entityType: "deadline",
    entityId: deadline.id,
    diff: { occurrenceId, dueOn: occurrence.dueOn, completionKind: c.completionKind, proof: Boolean(c.documentId || c.reference) },
  });
  return ok({ id: deadline.id });
}

/** Chiude tutte le date ancora aperte di una scadenza (es. la rata di un condominio risulta pagata). */
export async function completeOpenOccurrences(deps: DeadlineDeps, deadlineId: string, raw: { completedOn: string; reference: string }, today: string): Promise<Result<{ id: string; completed: number }>> {
  const deadline = await deps.repo.getDeadline(deadlineId);
  if (!deadline) return failGeneral("Scadenza non trovata");
  let completed = 0;
  for (const o of await deps.repo.occurrencesOf(deadlineId)) {
    if (o.status !== "open") continue;
    const done = await completeOccurrence(deps, o.id, { completedOn: raw.completedOn, completionKind: "owner", reference: raw.reference }, today);
    if (done.ok) completed += 1;
  }
  return ok({ id: deadlineId, completed });
}

export async function addProof(deps: DeadlineDeps, occurrenceId: string, raw: { documentId?: string; reference?: string }): Promise<Result<{ id: string }>> {
  const loaded = await loadOccurrence(deps, occurrenceId);
  if (!loaded) return failGeneral("Data non trovata");
  if (!raw.documentId && !raw.reference?.trim()) return fail({ reference: ["Indica un documento o un riferimento"] });
  if (raw.documentId && !(await deps.others.documentTitles([raw.documentId])).has(raw.documentId)) return fail({ documentId: ["Il documento non esiste"] });
  await deps.repo.addProof(occurrenceId, { documentId: raw.documentId, reference: raw.reference?.trim().slice(0, 300) });
  await deps.audit.record({ action: "deadline.proof.add", entityType: "deadline", entityId: loaded.deadline.id, diff: { occurrenceId } });
  return ok({ id: loaded.deadline.id });
}

export async function reopenOccurrence(deps: DeadlineDeps, occurrenceId: string): Promise<Result<{ id: string }>> {
  const loaded = await loadOccurrence(deps, occurrenceId);
  if (!loaded) return failGeneral("Data non trovata");
  await deps.repo.updateOccurrence(occurrenceId, { status: "open", completedOn: null, completionKind: null });
  await deps.audit.record({ action: "deadline.occurrence.reopen", entityType: "deadline", entityId: loaded.deadline.id, diff: { occurrenceId } });
  return ok({ id: loaded.deadline.id });
}

export async function cancelOccurrence(deps: DeadlineDeps, occurrenceId: string): Promise<Result<{ id: string }>> {
  const loaded = await loadOccurrence(deps, occurrenceId);
  if (!loaded) return failGeneral("Data non trovata");
  await deps.repo.updateOccurrence(occurrenceId, { status: "cancelled" });
  await deps.audit.record({ action: "deadline.occurrence.cancel", entityType: "deadline", entityId: loaded.deadline.id, diff: { occurrenceId } });
  return ok({ id: loaded.deadline.id });
}

/** Rinvio: sospende gli avvisi fino a una data futura. La scadenza resta com'e', e se e' passata resta in ritardo. */
export async function snoozeOccurrence(deps: DeadlineDeps, occurrenceId: string, until: string, today: string): Promise<Result<{ id: string }>> {
  const loaded = await loadOccurrence(deps, occurrenceId);
  if (!loaded) return failGeneral("Data non trovata");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= today) return fail({ snoozeUntil: ["Scegli una data futura"] });
  await deps.repo.updateOccurrence(occurrenceId, { snoozedUntil: until });
  await deps.audit.record({ action: "deadline.occurrence.snooze", entityType: "deadline", entityId: loaded.deadline.id, diff: { occurrenceId, until } });
  return ok({ id: loaded.deadline.id });
}

// ---------------------------------------------------------------------------------------------------- letture

export type OccurrenceListItem = OccurrenceView & { overdue: boolean; daysLeft: number };

const daysLeft = (dueOn: string, today: string) => Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

export type DeadlineView = "upcoming" | "overdue" | "open" | "done" | "all";

export async function listOccurrences(deps: DeadlineReadDeps, view: DeadlineView, filter: Omit<OccurrenceFilter, "statuses" | "before">, today: string, options: { windowDays?: number } = {}): Promise<OccurrenceListItem[]> {
  const base: OccurrenceFilter = { ...filter };
  if (view === "overdue") Object.assign(base, { statuses: ["open"], before: today });
  else if (view === "upcoming") Object.assign(base, { statuses: ["open"], from: today, to: addDays(today, options.windowDays ?? 90) });
  else if (view === "open") base.statuses = ["open"];
  else if (view === "done") base.statuses = ["done"];
  const rows = await deps.repo.listOccurrences(base);
  return rows.map((r) => ({ ...r, overdue: isOverdue(r, today), daysLeft: daysLeft(r.dueOn, today) }));
}

export type DeadlineDetail = {
  deadline: DeadlineRow & { assetName: string | null; responsibleName: string | null; professionalName: string | null };
  occurrences: (OccurrenceRow & { overdue: boolean; proofs: (ProofRow & { documentTitle: string | null })[] })[];
};

export async function getDeadlineDetail(deps: DeadlineReadDeps, id: string, today: string): Promise<DeadlineDetail | null> {
  const deadline = await deps.repo.getDeadline(id);
  if (!deadline) return null;
  const [assets, parties, occurrences] = await Promise.all([deps.others.assetNames(), deps.others.partyNames(), deps.repo.occurrencesOf(id)]);
  const proofs = await deps.repo.proofsOf(occurrences.map((o) => o.id));
  const titles = await deps.others.documentTitles(proofs.flatMap((p) => (p.documentId ? [p.documentId] : [])));
  return {
    deadline: {
      ...deadline,
      assetName: deadline.assetId ? (assets.get(deadline.assetId) ?? null) : null,
      responsibleName: deadline.responsiblePartyId ? (parties.get(deadline.responsiblePartyId) ?? null) : null,
      professionalName: deadline.professionalPartyId ? (parties.get(deadline.professionalPartyId) ?? null) : null,
    },
    occurrences: occurrences
      .map((o) => ({ ...o, overdue: isOverdue(o, today), proofs: proofs.filter((p) => p.occurrenceId === o.id).map((p) => ({ ...p, documentTitle: p.documentId ? (titles.get(p.documentId) ?? null) : null })) }))
      .sort((a, b) => b.dueOn.localeCompare(a.dueOn)),
  };
}

export async function listDeadlines(deps: DeadlineReadDeps, args: { assetId?: string; includeArchived?: boolean } = {}): Promise<DeadlineRow[]> {
  return deps.repo.listDeadlines(args);
}

export type Summary = { overdue: number; next7: number; next30: number; unreadNotifications: number };

export async function summary(deps: DeadlineReadDeps, today: string): Promise<Summary> {
  const [overdue, next30, unread] = await Promise.all([
    deps.repo.listOccurrences({ statuses: ["open"], before: today }),
    deps.repo.listOccurrences({ statuses: ["open"], from: today, to: addDays(today, 30) }),
    deps.repo.countUnread(),
  ]);
  return { overdue: overdue.length, next7: next30.filter((o) => o.dueOn <= addDays(today, 7)).length, next30: next30.length, unreadNotifications: unread };
}

export const listNotifications = (deps: DeadlineReadDeps, args: { unreadOnly: boolean; limit?: number }) => deps.repo.listNotifications({ unreadOnly: args.unreadOnly, limit: args.limit ?? 100 });
export const countUnread = (deps: DeadlineReadDeps) => deps.repo.countUnread();

export async function markNotificationRead(deps: DeadlineDeps, id: string | null): Promise<void> {
  await deps.repo.markRead(id);
  await deps.audit.record({ action: id ? "notification.read" : "notification.read_all", entityType: "notification", entityId: id ?? "all", diff: {} });
}

// ---------------------------------------------------------------------------------------------------- giro giornaliero

export type CycleResult = { occurrences: number; notifications: number; emails: number; emailErrors: number };

/**
 * Giro giornaliero (idempotente): calcola le nuove date delle scadenze, crea gli avvisi dovuti e, se c'e' un servizio email,
 * li invia. Un avviso ha chiave univoca (data, preavviso, scadenza): se il giro parte due volte nulla si duplica.
 */
export async function runDailyCycle(deps: DeadlineDeps, today: string, options: { mail?: MailPort; baseUrl?: string } = {}): Promise<CycleResult> {
  const result: CycleResult = { occurrences: 0, notifications: 0, emails: 0, emailErrors: 0 };

  for (const deadline of await deps.repo.listDeadlines({ includeArchived: false })) result.occurrences += (await materialize(deps, deadline, today)).created;

  const open = await deps.repo.listOccurrences({ statuses: ["open"] });
  for (const o of open) {
    if (o.archived) continue;
    if (o.snoozedUntil && o.snoozedUntil > today) continue;
    if (daysLeft(o.dueOn, today) < -STOP_ESCALATION_AFTER_DAYS) continue;
    const step = pendingStep(o.dueOn, today, o.leadDays);
    if (step === null) continue;
    const text = notificationText({ title: o.title, assetName: o.assetName, dueOn: o.dueOn, lead: step });
    if (await deps.repo.insertNotification({ occurrenceId: o.id, leadDays: step, dueOn: o.dueOn, ...text })) result.notifications += 1;
  }

  const mail = options.mail;
  const enabled = (await deps.repo.getSetting("notifications.email_enabled")) === true;
  if (mail?.configured && enabled) {
    const configured = await deps.repo.getSetting("notifications.email_address");
    const to = typeof configured === "string" && configured.trim() !== "" ? configured.trim() : await deps.others.ownerEmail();
    if (to) {
      // Solo gli avvisi nati dopo l'attivazione delle email: attivarle non deve spedire in un colpo tutti quelli arretrati.
      const enabledAt = await deps.repo.getSetting("notifications.email_enabled_at");
      const since = typeof enabledAt === "string" ? new Date(enabledAt) : new Date(0);
      for (const n of await deps.repo.pendingEmails(50, since)) {
        try {
          await mail.send({ to, subject: n.title, text: `${n.body}${options.baseUrl ? `\n\n${options.baseUrl}/scadenze/${n.deadlineId}` : ""}` });
          await deps.repo.setEmailResult(n.id, { sentAt: new Date() });
          result.emails += 1;
        } catch (error) {
          await deps.repo.setEmailResult(n.id, { error: (error instanceof Error ? error.message : "Errore sconosciuto").slice(0, 300) });
          result.emailErrors += 1;
        }
      }
    }
  }

  await deps.audit.record({ action: "deadline.cycle", entityType: "deadline", entityId: "cycle", diff: { ...result, today } });
  return result;
}

export type NotificationSettings = { emailEnabled: boolean; emailAddress: string };

export async function getNotificationSettings(deps: DeadlineReadDeps): Promise<NotificationSettings> {
  const [enabled, address] = await Promise.all([deps.repo.getSetting("notifications.email_enabled"), deps.repo.getSetting("notifications.email_address")]);
  return { emailEnabled: enabled === true, emailAddress: typeof address === "string" ? address : "" };
}

export async function saveNotificationSettings(deps: DeadlineDeps, raw: { emailEnabled: boolean; emailAddress: string }): Promise<Result<{ ok: true }>> {
  const address = raw.emailAddress.trim();
  if (address !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return fail({ emailAddress: ["Indirizzo email non valido"] });
  const wasEnabled = (await deps.repo.getSetting("notifications.email_enabled")) === true;
  if (raw.emailEnabled && !wasEnabled) await deps.repo.setSetting("notifications.email_enabled_at", new Date().toISOString());
  await deps.repo.setSetting("notifications.email_enabled", raw.emailEnabled);
  await deps.repo.setSetting("notifications.email_address", address);
  await deps.audit.record({ action: "settings.notifications", entityType: "settings", entityId: "notifications", diff: { emailEnabled: raw.emailEnabled, hasAddress: address !== "" } });
  return ok({ ok: true });
}

