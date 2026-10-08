import { isCalendarDate } from "@/shared/dates";

/**
 * Una data scritta come «gg/mm/aaaa» (anche con «-» o «.» come separatore) o «aaaa-mm-gg» diventa «aaaa-mm-gg».
 * Una cella vuota non e' un errore (`value` assente); una data inesistente (31/02/2026) o in un altro formato si': `invalid`.
 */
export function parseFlexibleDate(raw: string): { value?: string; invalid?: true } {
  const text = raw.trim();
  if (text === "") return {};
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const italian = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const parts = iso ? [iso[1]!, iso[2]!, iso[3]!] : italian ? [italian[3]!, italian[2]!, italian[1]!] : null;
  if (!parts) return { invalid: true };
  const value = `${parts[0]}-${parts[1]!.padStart(2, "0")}-${parts[2]!.padStart(2, "0")}`;
  return isCalendarDate(value) ? { value } : { invalid: true };
}

export const DATE_HINT = "usa gg/mm/aaaa oppure aaaa-mm-gg";
