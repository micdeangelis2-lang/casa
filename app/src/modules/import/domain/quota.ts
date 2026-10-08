/** Una quota scritta come «50%», «33,5%», «1/2» o «0,5» diventa numeratore e denominatore interi. */
export type Quota = { numerator: number; denominator: number };

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function parseQuota(raw: string): Quota | null {
  const text = raw.trim().replace(/\s+/g, "");
  let num: number;
  let den: number;
  const fraction = /^(\d{1,7})\/(\d{1,7})$/.exec(text);
  const percent = /^(\d{1,3})(?:[.,](\d{1,2}))?%$/.exec(text);
  if (fraction) {
    num = Number(fraction[1]);
    den = Number(fraction[2]);
  } else if (percent) {
    const decimals = percent[2] ?? "";
    num = Number(`${percent[1]}${decimals}`);
    den = 100 * 10 ** decimals.length;
  } else return null;
  if (num <= 0 || den <= 0 || num > den) return null;
  const g = gcd(num, den);
  return { numerator: num / g, denominator: den / g };
}
