import { euroAmount, optionalDate, optionalEuroAmount, optionalText, optionalUuid, requiredDate, requiredText, z } from "@/shared/zod";
import { parseMilli } from "./millesimi";

const optionalMilli = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined) return undefined;
        const m = parseMilli(v);
        if (m === null) ctx.addIssue({ code: "custom", message: `${label}: millesimi non validi (es. 48,25)` });
        return m ?? undefined;
      }),
  );

export const condominiumInputSchema = z.object({
  name: requiredText("Nome", 160),
  address: optionalText(300),
  taxCode: optionalText(20),
  administratorPartyId: optionalUuid,
  notes: optionalText(2000),
});

export const membershipSchema = z.object({ assetId: z.uuid("Scegli l'immobile"), unitLabel: optionalText(80) });

export const millesimalTableSchema = z.object({ name: requiredText("Nome della tabella", 120), note: optionalText(500) });

/** Valori della tabella: per ogni immobile del condominio i millesimi come testo. */
export const sharesSchema = z.array(z.object({ assetId: z.uuid(), value: z.string().trim() })).max(500);

export const fiscalYearSchema = z
  .object({ label: requiredText("Esercizio", 60), startsOn: requiredDate, endsOn: requiredDate })
  .superRefine((y, ctx) => {
    if (y.endsOn < y.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "La data di fine è precedente a quella di inizio" });
  });

export const BUDGET_KINDS = ["ordinary", "extraordinary", "final"] as const;
export type BudgetKind = (typeof BUDGET_KINDS)[number];
/** Di chi e' il totale di un preventivo: del solo proprietario (predefinito) o dell'intero palazzo. */
export const BUDGET_SCOPES = ["owner_only", "building"] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

export const budgetSchema = z.object({
  kind: z.enum(BUDGET_KINDS, { error: "Scegli il tipo" }),
  title: requiredText("Titolo", 200),
  total: euroAmount("Importo"),
  millesimalTableId: optionalUuid,
  scope: z.enum(BUDGET_SCOPES, { error: "Scegli di chi è il totale" }).default("owner_only"),
  note: optionalText(500),
  documentId: optionalUuid,
});

/** Millesimi delle unita' degli altri condomini di una tabella: una riga per voce («nome», millesimi come testo). */
export const otherSharesSchema = z.array(z.object({ label: z.string().trim().max(120), value: z.string().trim() })).max(100);

export const installmentPlanSchema = z.object({
  count: z.coerce.number({ error: "Inserisci il numero di rate" }).int("Numero intero").min(1, "Almeno una rata").max(60, "Massimo 60 rate"),
  firstDueOn: requiredDate,
  everyMonths: z.coerce.number({ error: "Inserisci ogni quanti mesi" }).int("Numero intero").min(1, "Almeno 1 mese").max(24, "Massimo 24 mesi"),
  createDeadlines: z.boolean().default(false),
});

export const paymentSchema = z.object({ paid: euroAmount("Importo pagato"), paidOn: z.preprocess((v) => (v === "" ? undefined : v), requiredDate.optional()), documentId: optionalUuid });

export const MEETING_KINDS = ["ordinary", "extraordinary"] as const;
export const MEETING_STATUSES = ["convened", "held", "cancelled"] as const;

export const meetingSchema = z.object({
  kind: z.enum(MEETING_KINDS, { error: "Scegli il tipo di assemblea" }),
  status: z.enum(MEETING_STATUSES, { error: "Scegli lo stato" }).default("convened"),
  convenedOn: optionalDate,
  meetingOn: requiredDate,
  location: optionalText(200),
  convocationDocumentId: optionalUuid,
  minutesDocumentId: optionalUuid,
  notes: optionalText(2000),
});

export const agendaItemSchema = z.object({ title: requiredText("Punto all'ordine del giorno", 300), description: optionalText(1000), questions: optionalText(1500) });
export const proxySchema = z.object({ delegatePartyId: z.uuid("Scegli il delegato dalla rubrica"), note: optionalText(500), documentId: optionalUuid });

export const RESOLUTION_OUTCOMES = ["not_recorded", "approved", "rejected", "postponed"] as const;
export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

export const resolutionSchema = z.object({
  title: requiredText("Delibera", 300),
  text: optionalText(3000),
  agendaItemId: optionalUuid,
  outcome: z.enum(RESOLUTION_OUTCOMES, { error: "Scegli l'esito" }).default("not_recorded"),
  votesFor: optionalMilli("Favorevoli"),
  votesAgainst: optionalMilli("Contrari"),
  votesAbstain: optionalMilli("Astenuti"),
  threshold: optionalMilli("Soglia"),
  thresholdNote: optionalText(300),
});

export const followUpDeadlineSchema = z.object({ title: requiredText("Titolo della scadenza", 200), dueOn: requiredDate });

export const WORK_STATUSES = ["planned", "quoted", "approved", "in_progress", "completed"] as const;
export const workSchema = z.object({ title: requiredText("Lavoro", 200), status: z.enum(WORK_STATUSES, { error: "Scegli lo stato" }).default("planned"), budget: optionalEuroAmount("Importo previsto"), resolutionId: optionalUuid, note: optionalText(1000) });

export const WORK_ENTRY_KINDS = ["quote", "progress", "invoice"] as const;
export const workEntrySchema = z.object({ kind: z.enum(WORK_ENTRY_KINDS, { error: "Scegli il tipo" }), title: requiredText("Titolo", 200), amount: optionalEuroAmount("Importo"), entryOn: optionalDate, documentId: optionalUuid });

export const CLAIM_KINDS = ["claim", "dispute", "report", "communication"] as const;
export const claimSchema = z.object({
  kind: z.enum(CLAIM_KINDS, { error: "Scegli il tipo" }),
  title: requiredText("Titolo", 200),
  description: optionalText(2000),
  status: z.enum(["open", "closed"], { error: "Scegli lo stato" }).default("open"),
  openedOn: optionalDate,
  matterId: optionalUuid,
});

export const CONTRACT_KINDS = ["contract", "certification"] as const;
export const contractSchema = z
  .object({ kind: z.enum(CONTRACT_KINDS, { error: "Scegli il tipo" }), title: requiredText("Titolo", 200), counterpartyPartyId: optionalUuid, validFrom: optionalDate, validTo: optionalDate, documentId: optionalUuid, note: optionalText(500) })
  .superRefine((c, ctx) => {
    if (c.validFrom && c.validTo && c.validTo < c.validFrom) ctx.addIssue({ code: "custom", path: ["validTo"], message: "La data di fine è precedente a quella di inizio" });
  });

export const DOCUMENT_KINDS = ["regulation", "millesimal", "other"] as const;

export const isPaid = (i: { amountCents: number; paidCents: number }) => i.paidCents >= i.amountCents;
