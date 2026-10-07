import { parseEuroToCents } from "@/shared/money";
import { optionalDate, optionalEuroAmount, optionalText, requiredText, z } from "@/shared/zod";

export { parseEuroToCents };

/**
 * Tipi di bene. Immobili e pertinenze sono lo stesso record: un unico modulo di inserimento vale per qualunque situazione.
 * Le etichette italiane stanno in messages/it.json.
 */
export const ASSET_KINDS = [
  "dwelling",
  "detached_house",
  "garage",
  "box",
  "parking",
  "cellar",
  "commercial",
  "land",
  "other",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const USE_TYPES = ["primary_residence", "secondary_residence", "let", "hospitality", "business", "unused", "other"] as const;
export type UseType = (typeof USE_TYPES)[number];

export const RIGHT_TYPES = ["full", "co_ownership", "usufruct", "bare_ownership"] as const;
export type RightType = (typeof RIGHT_TYPES)[number];

export const LINK_VALIDATION = ["declared", "documented", "validated_by_professional"] as const;
export type LinkValidation = (typeof LINK_VALIDATION)[number];

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const quotaNumber = (label: string) =>
  z.coerce
    .number({ error: `${label}: inserisci un numero intero` })
    .int(`${label}: inserisci un numero intero`)
    .min(1, `${label}: deve essere almeno 1`)
    .max(1_000_000, `${label}: valore troppo grande`);

const rightSchema = z
  .object({
    holder: z.discriminatedUnion(
      "type",
      [
        z.object({ type: z.literal("self") }),
        z.object({ type: z.literal("party"), partyId: z.uuid("Scegli il titolare dalla rubrica") }),
      ],
      { error: "Scegli il titolare" },
    ),
    rightType: z.enum(RIGHT_TYPES, { error: "Scegli il tipo di diritto" }),
    quotaNumerator: quotaNumber("Quota (numeratore)"),
    quotaDenominator: quotaNumber("Quota (denominatore)"),
    validFrom: optionalDate,
    validTo: optionalDate,
    notes: optionalText(500),
  })
  .superRefine((r, ctx) => {
    if (r.quotaNumerator > r.quotaDenominator) {
      ctx.addIssue({ code: "custom", path: ["quotaNumerator"], message: "La quota non può superare l'intero" });
    }
    if (r.validFrom && r.validTo && r.validTo < r.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "La data di fine è precedente a quella di inizio" });
    }
  });

const cadastralSchema = z
  .object({
    sheet: optionalText(20),
    parcel: optionalText(20),
    subunit: optionalText(20),
    cadastralCategory: optionalText(20),
    cadastralClass: optionalText(20),
    consistency: optionalText(40),
    income: z.preprocess(emptyToUndefined, z.string().optional()),
    validFrom: optionalDate,
    validTo: optionalDate,
    notes: optionalText(500),
  })
  .superRefine((c, ctx) => {
    const hasData = [c.sheet, c.parcel, c.subunit, c.cadastralCategory, c.cadastralClass, c.consistency, c.income].some(Boolean);
    if (!hasData) ctx.addIssue({ code: "custom", path: ["sheet"], message: "Compila almeno un dato catastale o elimina la riga" });
    if (c.income !== undefined && parseEuroToCents(c.income) === null) {
      ctx.addIssue({ code: "custom", path: ["income"], message: "Rendita non valida (es. 1.234,56)" });
    }
    if (c.validFrom && c.validTo && c.validTo < c.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "La data di fine è precedente a quella di inizio" });
    }
  })
  .transform(({ income, ...rest }) => ({ ...rest, incomeCents: income === undefined ? undefined : parseEuroToCents(income)! }));

const linkSchema = z.object({
  mainAssetId: z.uuid("Scegli il bene a cui è collegato"),
  declaredBasis: optionalText(500),
  validationStatus: z.enum(LINK_VALIDATION).default("declared"),
});

/** Caratteristiche tecniche libere (anno di costruzione, impianti...): servono ai fatti che il motore delle regole valuta. */
export const ATTRIBUTE_TYPES = ["text", "number", "boolean"] as const;
export type AttributeValue = string | number | boolean;

const attributeSchema = z
  .object({
    key: z
      .string({ error: "Nome della caratteristica obbligatorio" })
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, "Il nome usa lettere minuscole, cifre e _ (es. anno_costruzione)"),
    type: z.enum(ATTRIBUTE_TYPES, { error: "Scegli il tipo" }),
    value: z.string({ error: "Valore obbligatorio" }).trim().min(1, "Valore obbligatorio").max(200, "Massimo 200 caratteri"),
  })
  .transform((a, ctx): { key: string; value: AttributeValue } => {
    if (a.type === "number") {
      const n = Number(a.value.replace(",", "."));
      if (!Number.isFinite(n)) ctx.addIssue({ code: "custom", path: ["value"], message: "Inserisci un numero" });
      return { key: a.key, value: n };
    }
    if (a.type === "boolean") {
      if (a.value !== "true" && a.value !== "false") ctx.addIssue({ code: "custom", path: ["value"], message: "Scegli sì o no" });
      return { key: a.key, value: a.value === "true" };
    }
    return { key: a.key, value: a.value };
  });

const greatestCommonDivisor = (a: bigint, b: bigint): bigint => (b === 0n ? a : greatestCommonDivisor(b, a % b));

/** Vero se la somma delle quote supera l'intero (calcolo esatto con frazioni, senza errori di arrotondamento). */
export function quotasExceedWhole(quotas: { quotaNumerator: number; quotaDenominator: number }[]): boolean {
  let num = 0n;
  let den = 1n;
  for (const q of quotas) {
    const n = BigInt(q.quotaNumerator);
    const d = BigInt(q.quotaDenominator);
    num = num * d + n * den;
    den = den * d;
    const g = greatestCommonDivisor(num, den);
    num /= g;
    den /= g;
  }
  return num > den;
}

export const assetInputSchema = z
  .object({
    kind: z.enum(ASSET_KINDS, { error: "Scegli il tipo di bene" }),
    name: requiredText("Denominazione", 160),
    territoryId: z.uuid("Scegli il Comune"),
    locality: optionalText(120),
    address: optionalText(200),
    postalCode: z.preprocess(emptyToUndefined, z.string().regex(/^\d{5}$/, "CAP: 5 cifre").optional()),
    useType: z.preprocess(emptyToUndefined, z.enum(USE_TYPES, { error: "Uso non valido" }).optional()),
    inCondominium: z.boolean().default(false),
    notes: optionalText(2000),
    rights: z.array(rightSchema).max(20, "Troppi diritti (massimo 20)").default([]),
    cadastral: z.array(cadastralSchema).max(20, "Troppe righe catastali (massimo 20)").default([]),
    links: z.array(linkSchema).max(20, "Troppi collegamenti (massimo 20)").default([]),
    attributes: z.array(attributeSchema).max(30, "Troppe caratteristiche (massimo 30)").default([]),
  })
  .superRefine((a, ctx) => {
    // Per ogni tipo di diritto "in corso" (senza data di fine) le quote non possono sommare piu' dell'intero.
    // Sommare MENO dell'intero e' lecito: gli altri titolari possono non essere registrati.
    for (const type of RIGHT_TYPES) {
      const current = a.rights.filter((r) => r.rightType === type && !r.validTo);
      if (current.length > 1 && quotasExceedWhole(current)) {
        a.rights.forEach((r, i) => {
          if (r.rightType === type && !r.validTo) {
            ctx.addIssue({ code: "custom", path: ["rights", i, "quotaNumerator"], message: "Le quote di questo diritto sommano più dell'intero" });
          }
        });
      }
    }
    const keys = new Set<string>();
    a.attributes.forEach((attr, i) => {
      if (keys.has(attr.key)) ctx.addIssue({ code: "custom", path: ["attributes", i, "key"], message: "Caratteristica ripetuta" });
      keys.add(attr.key);
    });
    const seen = new Set<string>();
    a.links.forEach((l, i) => {
      if (seen.has(l.mainAssetId)) ctx.addIssue({ code: "custom", path: ["links", i, "mainAssetId"], message: "Collegamento ripetuto" });
      seen.add(l.mainAssetId);
    });
  });

export type AssetInput = z.output<typeof assetInputSchema>;

/** Valore dichiarato dal proprietario: facoltativo, mai negativo, mai calcolato dall'app. */
export const declaredValueSchema = z.object({ declaredValue: optionalEuroAmount("Valore dichiarato") });

/** Elementi mostrati nella lista e nelle schede. */
export type AssetSummary = {
  id: string;
  kind: AssetKind;
  name: string;
  territoryId: string;
  locality: string | null;
  address: string | null;
  useType: UseType | null;
  /** Valore dichiarato dal proprietario, in centesimi (nullo = non dichiarato). */
  declaredValueCents: number | null;
  archived: boolean;
};

export type AssetDetail = AssetSummary & {
  postalCode: string | null;
  attributes: Record<string, AttributeValue>;
  inCondominium: boolean;
  notes: string | null;
  rights: {
    id: string;
    holder: { id: string; displayName: string };
    rightType: RightType;
    quotaNumerator: number;
    quotaDenominator: number;
    validFrom: string | null;
    validTo: string | null;
    notes: string | null;
  }[];
  cadastral: {
    id: string;
    sheet: string | null;
    parcel: string | null;
    subunit: string | null;
    cadastralCategory: string | null;
    cadastralClass: string | null;
    consistency: string | null;
    incomeCents: number | null;
    validFrom: string | null;
    validTo: string | null;
    notes: string | null;
  }[];
  /** Questo bene dichiara di essere collegato a... */
  linkedTo: { id: string; asset: { id: string; name: string; kind: AssetKind }; declaredBasis: string | null; validationStatus: LinkValidation }[];
  /** ...e questi beni dichiarano di essere collegati a questo. */
  linkedFrom: { id: string; asset: { id: string; name: string; kind: AssetKind }; declaredBasis: string | null; validationStatus: LinkValidation }[];
};
