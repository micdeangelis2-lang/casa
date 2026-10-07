/**
 * "1.234,56", "1.234" o "1234.56" -> centesimi. La virgola e' il decimale; con soli punti, gruppi di esattamente tre cifre
 * ("50.000", "1.234.567") sono migliaia all'italiana. Restituisce null se non e' un importo valido.
 */
export function parseEuroToCents(raw: string): number | null {
  const s = raw.replace(/\s|€/g, "");
  let normalized: string;
  if (s.includes(",")) normalized = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, "");
  else normalized = s;
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** 123456 -> "1.234,56". Il separatore delle migliaia c'e' sempre (l'ICU di it-IT lo omette sotto 10.000, e accanto a "20.000,00" sembrerebbe un errore). */
export const formatCents = (cents: number): string => (cents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
