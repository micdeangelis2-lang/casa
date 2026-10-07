import { isCalendarDate } from "@/shared/dates";
import { isUuid } from "@/lib/ids";

/** Immobile e periodo del rendiconto dall'indirizzo: date non valide o invertite tornano all'anno in corso fino a oggi. */
export function statementParams(get: (key: string) => string, today: string): { assetId: string | null; from: string; to: string } {
  const asked = get("immobile");
  const from = isCalendarDate(get("dal")) ? get("dal") : `${today.slice(0, 4)}-01-01`;
  const to = isCalendarDate(get("al")) ? get("al") : today;
  return { assetId: isUuid(asked) ? asked : null, ...(from <= to ? { from, to } : { from: `${today.slice(0, 4)}-01-01`, to: today }) };
}
