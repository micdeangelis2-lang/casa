import { optionalText, requiredText, z } from "@/shared/zod";

/** Stati di una voce del dossier (sezione 6 del prompt). Li sceglie il proprietario: il motore non li cambia mai. */
export const DOSSIER_STATUSES = [
  "present",
  "missing",
  "requested",
  "to_verify",
  "expired",
  "superseded",
  "not_applicable",
  "validated_by_professional",
] as const;
export type DossierStatus = (typeof DOSSIER_STATUSES)[number];

export const statusSchema = z.enum(DOSSIER_STATUSES, { error: "Scegli lo stato" });

export const manualItemSchema = z.object({
  categoryId: z.uuid("Scegli la categoria"),
  title: requiredText("Titolo", 200),
  ownerNote: optionalText(1000),
});

export const noteSchema = optionalText(1000);

/** Riepilogo per stato. Conta soltanto: non dice mai che il bene e' "a norma" o "completo". */
export function summarize(items: { status: DossierStatus }[]): { total: number; byStatus: Record<DossierStatus, number> } {
  const byStatus = Object.fromEntries(DOSSIER_STATUSES.map((s) => [s, 0])) as Record<DossierStatus, number>;
  for (const item of items) byStatus[item.status] += 1;
  return { total: items.length, byStatus };
}

/** Quando collegare un documento a una voce ancora "mancante" o "richiesta" il suo stato diventa "presente". */
export const AUTO_PRESENT_FROM: readonly DossierStatus[] = ["missing", "requested"];
