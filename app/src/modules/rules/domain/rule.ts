import { calcSchema, type Calc } from "@/shared/calc";
import { DEADLINE_CATEGORIES, PRIORITIES, type DeadlineCategory, type Priority } from "@/shared/deadline-vocab";
import { optionalDate, optionalText, requiredText, z } from "@/shared/zod";
import { conditionSchema, conditionShapeIssues, evaluateCondition, factsUsed, type Condition, type Facts, type Primitive, type Trace } from "./condition";

/** Livelli normativi (sezione 4 del prompt): ogni regola ne ha esattamente uno e l'interfaccia lo mostra sempre. */
export const RULE_LEVELS = ["national", "regional", "municipal", "condominium", "contract"] as const;
export type RuleLevel = (typeof RULE_LEVELS)[number];

export const RULE_VERIFICATION = ["draft", "to_verify", "verified_by_owner", "validated_by_professional"] as const;
export type RuleVerification = (typeof RULE_VERIFICATION)[number];

const outcomeKey = z
  .string({ error: "Codice dell'esito obbligatorio" })
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, "Il codice usa lettere minuscole, cifre e _ (es. visura_catastale)");

/**
 * Esiti di una regola. Oggi: voce di dossier (checklist) e avviso. Le scadenze arrivano con il loro incremento
 * come terzo tipo, senza cambiare gli esiti gia' scritti. Il `key` identifica l'esito nel tempo: finche' resta lo stesso
 * attraverso le versioni, la voce del dossier resta la stessa (e il suo stato scelto dal proprietario non si perde).
 */
export const outcomeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("checklist"),
    key: outcomeKey,
    title: requiredText("Titolo della voce", 200),
    /** Codice di una categoria del dossier (dato, non scritto nel codice). */
    dossierCategory: z.string().trim().min(1, "Scegli la categoria del dossier").max(40),
    /** Codice di una categoria documentale attesa, se serve. */
    expectedDocumentCategory: optionalText(40),
    note: optionalText(500),
  }),
  z.object({
    type: z.literal("notice"),
    key: outcomeKey,
    title: requiredText("Titolo dell'avviso", 200),
    message: requiredText("Testo dell'avviso", 600),
  }),
  /** Scadenza: la regola di calcolo e' RELATIVA a un'ancora (mai una data assoluta), come per le scadenze scritte a mano. */
  z.object({
    type: z.literal("deadline"),
    key: outcomeKey,
    title: requiredText("Titolo della scadenza", 200),
    category: z.enum(DEADLINE_CATEGORIES, { error: "Scegli la categoria della scadenza" }),
    calc: calcSchema,
    shiftToBusinessDay: z.boolean().default(false),
    priority: z.enum(PRIORITIES, { error: "Scegli la priorità" }).default("normal"),
    legalBasis: optionalText(500),
    consequences: optionalText(1000),
    requiredDocuments: optionalText(1000),
    proofRequired: z.boolean().default(false),
  }),
]);
export type Outcome = z.infer<typeof outcomeSchema>;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const ruleVersionInputSchema = z
  .object({
    title: requiredText("Titolo", 200),
    description: optionalText(1000),
    level: z.enum(RULE_LEVELS, { error: "Scegli il livello normativo" }),
    territoryId: z.preprocess(emptyToUndefined, z.uuid("Territorio non valido").optional()),
    validFrom: optionalDate,
    validTo: optionalDate,
    appliesWhen: conditionSchema.nullable().default(null),
    outcomes: z.array(outcomeSchema).min(1, "Serve almeno un esito").max(30, "Troppi esiti (massimo 30)"),
    sourceText: requiredText("Fonte", 500),
    sourceUrl: z.preprocess(emptyToUndefined, z.httpUrl("Indirizzo non valido").max(500).optional()),
    verificationStatus: z.enum(RULE_VERIFICATION, { error: "Scegli lo stato di verifica" }).default("to_verify"),
    changeNote: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if (v.validFrom && v.validTo && v.validTo < v.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "La data di fine validità è precedente a quella di inizio" });
    }
    const shape = v.appliesWhen ? conditionShapeIssues(v.appliesWhen) : null;
    if (shape) ctx.addIssue({ code: "custom", path: ["appliesWhen"], message: shape });
    const keys = new Set<string>();
    v.outcomes.forEach((o, i) => {
      if (keys.has(o.key)) ctx.addIssue({ code: "custom", path: ["outcomes", i, "key"], message: "Codice ripetuto" });
      keys.add(o.key);
    });
  });
export type RuleVersionInput = z.output<typeof ruleVersionInputSchema>;

/** Una versione cosi' come sta nel database (immutabile, tranne lo stato di verifica). */
export type RuleVersion = {
  id: string;
  versionNo: number;
  title: string;
  description: string | null;
  level: RuleLevel;
  territoryId: string | null;
  validFrom: string | null;
  validTo: string | null;
  appliesWhen: Condition | null;
  outcomes: Outcome[];
  sourceText: string;
  sourceUrl: string | null;
  verificationStatus: RuleVerification;
  changeNote: string | null;
  createdAt: Date;
};

export type RuleWithVersions = { id: string; key: string; active: boolean; versions: RuleVersion[] };

/** Chiave stabile di una regola nuova: dal titolo, senza accenti, piu' un suffisso per evitare collisioni. */
export function ruleKeyFrom(title: string, suffix: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${slug || "regola"}_${suffix}`;
}

/**
 * Versione in vigore alla data indicata: tra quelle la cui validita' contiene la data, quella col numero piu' alto.
 * Cosi' una regola puo' avere una versione per anno (o per periodo) e la modifica "in corso" sostituisce la precedente.
 */
export function effectiveVersion(rule: RuleWithVersions, asOf: string): RuleVersion | null {
  const valid = rule.versions.filter((v) => (!v.validFrom || v.validFrom <= asOf) && (!v.validTo || v.validTo >= asOf));
  return valid.reduce<RuleVersion | null>((best, v) => (best && best.versionNo > v.versionNo ? best : v), null);
}

/** Punto di vista di una voce derivata: cosa mostrare per spiegarla. */
export type Explanation = {
  ruleKey: string;
  ruleTitle: string;
  versionNo: number;
  level: RuleLevel;
  territoryId: string | null;
  verificationStatus: RuleVerification;
  sourceText: string;
  trace: Trace | null;
  facts: { path: string; value: Primitive | Primitive[] | null }[];
};

export type DerivedChecklistItem = {
  ruleKey: string;
  outcomeKey: string;
  versionId: string;
  title: string;
  dossierCategory: string;
  expectedDocumentCategory: string | null;
  note: string | null;
  explanation: Explanation;
};

export type DerivedNotice = { ruleKey: string; outcomeKey: string; title: string; message: string; explanation: Explanation };

/** Scadenza prodotta da una regola per un bene: la gestione (date, stato, avvisi) e' del modulo Scadenze. */
export type DerivedDeadline = {
  ruleKey: string;
  outcomeKey: string;
  versionId: string;
  title: string;
  category: DeadlineCategory;
  level: RuleLevel;
  calc: Calc;
  shiftToBusinessDay: boolean;
  priority: Priority;
  legalBasis: string | null;
  consequences: string | null;
  requiredDocuments: string | null;
  proofRequired: boolean;
  explanation: Explanation;
};

export type Evaluation = { items: DerivedChecklistItem[]; notices: DerivedNotice[]; deadlines: DerivedDeadline[]; applied: number };

/**
 * Valuta le regole su un bene. Una regola si applica se: e' attiva, ha una versione in vigore alla data, il territorio
 * della versione e' (o contiene) quello del bene e la condizione e' vera sui fatti. Nessun giudizio di conformita':
 * il risultato e' l'elenco di cio' che la regola dichiara atteso, con la spiegazione.
 */
export function evaluateRules(rules: RuleWithVersions[], facts: Facts, territoryChain: ReadonlySet<string>, asOf: string): Evaluation {
  const items: DerivedChecklistItem[] = [];
  const notices: DerivedNotice[] = [];
  const deadlines: DerivedDeadline[] = [];
  let applied = 0;

  for (const rule of rules) {
    if (!rule.active) continue;
    const version = effectiveVersion(rule, asOf);
    if (!version) continue;
    if (version.territoryId && !territoryChain.has(version.territoryId)) continue;
    const { result, trace } = evaluateCondition(version.appliesWhen, facts);
    if (!result) continue;
    applied += 1;

    const explanation: Explanation = {
      ruleKey: rule.key,
      ruleTitle: version.title,
      versionNo: version.versionNo,
      level: version.level,
      territoryId: version.territoryId,
      verificationStatus: version.verificationStatus,
      sourceText: version.sourceText,
      trace,
      facts: factsUsed(trace),
    };
    for (const outcome of version.outcomes) {
      if (outcome.type === "checklist") {
        items.push({
          ruleKey: rule.key,
          outcomeKey: outcome.key,
          versionId: version.id,
          title: outcome.title,
          dossierCategory: outcome.dossierCategory,
          expectedDocumentCategory: outcome.expectedDocumentCategory ?? null,
          note: outcome.note ?? null,
          explanation,
        });
      } else if (outcome.type === "notice") {
        notices.push({ ruleKey: rule.key, outcomeKey: outcome.key, title: outcome.title, message: outcome.message, explanation });
      } else {
        deadlines.push({
          ruleKey: rule.key,
          outcomeKey: outcome.key,
          versionId: version.id,
          title: outcome.title,
          category: outcome.category,
          level: version.level,
          calc: outcome.calc,
          shiftToBusinessDay: outcome.shiftToBusinessDay,
          priority: outcome.priority,
          legalBasis: outcome.legalBasis ?? null,
          consequences: outcome.consequences ?? null,
          requiredDocuments: outcome.requiredDocuments ?? null,
          proofRequired: outcome.proofRequired,
          explanation,
        });
      }
    }
  }
  return { items, notices, deadlines, applied };
}
