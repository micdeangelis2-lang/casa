import { fail, ok, type Result } from "@/shared/result";
import { notificationText, pendingStep } from "../domain/deadline";
import type { DeadlineDeps, DeadlineReadDeps, MailPort } from "./ports";
import { materialize } from "./definitions";
import { daysLeft } from "./reads";

const STOP_ESCALATION_AFTER_DAYS = 365;

export type CycleResult = { occurrences: number; notifications: number };
export type EmailResult = { emails: number; emailErrors: number };

/**
 * Giro giornaliero (idempotente): calcola le nuove date delle scadenze e crea gli avvisi dovuti. Un avviso ha chiave univoca
 * (data, preavviso, scadenza): se il giro parte due volte nulla si duplica. Le email NON partono da qui (`sendDueEmails`):
 * un servizio lento terrebbe aperta la transazione e il blocco dell'audit, fermando ogni altra scrittura dell'app.
 */
export async function runDailyCycle(deps: DeadlineDeps, today: string): Promise<CycleResult> {
  const result: CycleResult = { occurrences: 0, notifications: 0 };

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

  await deps.audit.record({ action: "deadline.cycle", entityType: "deadline", entityId: "cycle", diff: { ...result, today } });
  return result;
}

/**
 * Invia le email degli avvisi non ancora spediti (al piu' 50 per giro). Va chiamata FUORI da una transazione: `store` registra
 * l'esito di ogni invio in una transazione breve a parte, cosi' un invio riuscito non si perde se un passo successivo fallisce
 * (e l'avviso non riparte due volte).
 */
export async function sendDueEmails(
  deps: DeadlineReadDeps,
  store: (notificationId: string, result: { sentAt: Date } | { error: string }) => Promise<void>,
  options: { mail?: MailPort; baseUrl?: string } = {},
): Promise<EmailResult> {
  const result: EmailResult = { emails: 0, emailErrors: 0 };
  const mail = options.mail;
  const enabled = (await deps.repo.getSetting("notifications.email_enabled")) === true;
  if (!mail?.configured || !enabled) return result;
  const configured = await deps.repo.getSetting("notifications.email_address");
  const to = typeof configured === "string" && configured.trim() !== "" ? configured.trim() : await deps.others.ownerEmail();
  if (!to) return result;
  // Solo gli avvisi nati dopo l'attivazione delle email: attivarle non deve spedire in un colpo tutti quelli arretrati.
  const enabledAt = await deps.repo.getSetting("notifications.email_enabled_at");
  const since = typeof enabledAt === "string" ? new Date(enabledAt) : new Date(0);
  for (const n of await deps.repo.pendingEmails(50, since)) {
    try {
      await mail.send({ to, subject: n.title, text: `${n.body}${options.baseUrl ? `\n\n${options.baseUrl}/scadenze/${n.deadlineId}` : ""}` });
    } catch (error) {
      await store(n.id, { error: (error instanceof Error ? error.message : "Errore sconosciuto").slice(0, 300) });
      result.emailErrors += 1;
      continue;
    }
    await store(n.id, { sentAt: new Date() });
    result.emails += 1;
  }
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
