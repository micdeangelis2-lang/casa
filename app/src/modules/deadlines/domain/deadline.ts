import { optionalDate, optionalText, requiredText, z } from "@/shared/zod";
import { daysBetween } from "@/shared/dates";
import { calcSchema } from "@/shared/calc";
import { DEADLINE_CATEGORIES, LEVELS, PRIORITIES, type Priority } from "@/shared/deadline-vocab";

export { DEADLINE_CATEGORIES, LEVELS, PRIORITIES, type DeadlineCategory, type Priority } from "@/shared/deadline-vocab";




export const COMPLETION_KINDS = ["owner", "auto_verified", "professional_validated"] as const;
export type CompletionKind = (typeof COMPLETION_KINDS)[number];

export const OCCURRENCE_STATUSES = ["open", "done", "cancelled"] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

/** Avvisi predefiniti per priorita': giorni prima della scadenza (0 = il giorno stesso). */
export const DEFAULT_LEAD_DAYS: Record<Priority, number[]> = {
  low: [7, 0],
  normal: [30, 7, 1, 0],
  high: [60, 30, 14, 7, 3, 1, 0],
  urgent: [90, 60, 30, 14, 7, 3, 1, 0],
};

const optionalUuid = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.uuid("Scelta non valida").optional());

const leadDaysSchema = z
  .array(z.number().int("Solo numeri interi").min(0, "I giorni di preavviso non sono negativi").max(730, "Preavviso troppo lungo"))
  .max(12, "Troppi preavvisi (massimo 12)")
  .transform((list) => [...new Set(list)].sort((a, b) => b - a));

export const deadlineInputSchema = z
  .object({
    title: requiredText("Titolo", 200),
    description: optionalText(1000),
    category: z.enum(DEADLINE_CATEGORIES, { error: "Scegli la categoria" }),
    level: z.enum(LEVELS, { error: "Scegli il livello normativo" }),
    legalBasis: optionalText(500),
    assetId: optionalUuid,
    responsiblePartyId: optionalUuid,
    professionalPartyId: optionalUuid,
    /** Pratica a cui collegare la scadenza (facoltativa). */
    matterId: optionalUuid,
    calc: calcSchema,
    shiftToBusinessDay: z.boolean().default(false),
    priority: z.enum(PRIORITIES, { error: "Scegli la priorità" }).default("normal"),
    consequences: optionalText(1000),
    requiredDocuments: optionalText(1000),
    leadDays: leadDaysSchema.optional(),
    proofRequired: z.boolean().default(false),
    /** Solo per le scadenze «manuali»: la prima data. */
    firstDueOn: optionalDate,
  })
  .superRefine((d, ctx) => {
    if (d.calc.type === "manual" && !d.firstDueOn) ctx.addIssue({ code: "custom", path: ["firstDueOn"], message: "Per una scadenza manuale indica la data" });
  });
export type DeadlineInput = z.output<typeof deadlineInputSchema>;

/** Richiesta di chiusura di una scadenza: prova, data e chi la attesta. */
export const completionSchema = z
  .object({
    completedOn: optionalDate,
    completionKind: z.enum(COMPLETION_KINDS, { error: "Scegli chi attesta l'adempimento" }).default("owner"),
    documentId: optionalUuid,
    reference: optionalText(300),
    note: optionalText(500),
  })
  .transform((c) => c);

/** Una scadenza e' in ritardo se e' aperta e la data e' passata. */
export const isOverdue = (o: { status: OccurrenceStatus; dueOn: string }, today: string): boolean => o.status === "open" && o.dueOn < today;

/** Passi di escalation per le scadenze in ritardo (giorni di ritardo), poi ogni 30 giorni. */
export const ESCALATION_STEPS = [1, 3, 7, 14, 30] as const;

/**
 * Preavviso da dare oggi, o null. Prima della scadenza: il passo piu' vicino gia' raggiunto (il piu' piccolo `lead` >= giorni
 * che mancano). In ritardo: un numero negativo = giorni di ritardo dell'ultimo passo raggiunto. Se il giro non gira per qualche
 * giorno non arrivano piu' avvisi in blocco: conta solo il passo piu' recente.
 */
export function pendingStep(dueOn: string, today: string, leadDays: readonly number[]): number | null {
  if (today <= dueOn) {
    const remaining = daysBetween(today, dueOn);
    const reached = leadDays.filter((l) => l >= remaining);
    return reached.length > 0 ? Math.min(...reached) : null;
  }
  const late = daysBetween(dueOn, today);
  if (late < 30) return -Math.max(...ESCALATION_STEPS.filter((s) => s <= late));
  return -30 * Math.floor(late / 30);
}

/** Testo neutro dell'avviso (nessun giudizio: ricorda una data, non dice cosa e' dovuto per legge). */
export function notificationText(args: { title: string; assetName: string | null; dueOn: string; lead: number }): { title: string; body: string } {
  const where = args.assetName ? ` – ${args.assetName}` : "";
  const date = args.dueOn.split("-").reverse().join("/");
  if (args.lead < 0) {
    const late = -args.lead;
    return { title: `In ritardo da ${late} ${late === 1 ? "giorno" : "giorni"}: ${args.title}`, body: `La data era il ${date}${where}. Controlla se è stata completata o se serve aggiornarla.` };
  }
  if (args.lead === 0) return { title: `Oggi: ${args.title}`, body: `Scadenza il ${date}${where}.` };
  return { title: `Tra ${args.lead} ${args.lead === 1 ? "giorno" : "giorni"}: ${args.title}`, body: `Scadenza il ${date}${where}.` };
}
