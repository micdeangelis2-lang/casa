import { RULE_VERIFICATION } from "@/modules/rules";
import { optionalDate, optionalText, requiredText, z } from "@/shared/zod";

/**
 * Modulistica di un ufficio come la annota il proprietario: nome, checklist di documenti (testo libero, una voce per riga),
 * fonte, data di verifica e stato. Nessun modulo o requisito reale e' scritto nel codice: l'app non dice cosa un ufficio
 * richieda e non giudica se la checklist sia completa.
 */

const MAX_CHECKLIST_ITEMS = 50;
const MAX_CHECKLIST_ITEM_LENGTH = 200;

/** Le righe di un testo diventano voci: spazi tolti, righe vuote e doppioni (stessa voce, maiuscole a parte) ignorati. */
export function parseChecklist(text: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const item = line.trim().replace(/^[-*•]\s+/, "");
    if (item === "" || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    items.push(item);
  }
  return items;
}

export const formTemplateSchema = z
  .object({
    officePartyId: z.uuid("Scegli l'ufficio dalla rubrica"),
    name: requiredText("Nome del modulo", 200),
    checklist: z.preprocess((v) => (v === undefined || v === null ? "" : v), z.string().max(8000, "Elenco troppo lungo")),
    source: optionalText(300),
    verifiedOn: optionalDate,
    verificationStatus: z.enum(RULE_VERIFICATION, { error: "Scegli lo stato di verifica" }).default("to_verify"),
    note: optionalText(500),
  })
  .transform((v, ctx) => {
    const items = parseChecklist(v.checklist);
    if (items.length > MAX_CHECKLIST_ITEMS) ctx.addIssue({ code: "custom", path: ["checklist"], message: `Al massimo ${MAX_CHECKLIST_ITEMS} voci` });
    if (items.some((i) => i.length > MAX_CHECKLIST_ITEM_LENGTH)) ctx.addIssue({ code: "custom", path: ["checklist"], message: `Ogni voce può avere al massimo ${MAX_CHECKLIST_ITEM_LENGTH} caratteri` });
    if ((v.verificationStatus === "verified_by_owner" || v.verificationStatus === "validated_by_professional") && !v.verifiedOn) {
      ctx.addIssue({ code: "custom", path: ["verifiedOn"], message: "Indica la data in cui hai verificato il modulo" });
    }
    return { ...v, checklist: items };
  });
export type FormTemplateInput = z.output<typeof formTemplateSchema>;
