/** Regole pure della pagina «Sicurezza dell'account»: nessun accesso a database, rete o framework. */

/** Invariante E6: TOTP attivo e almeno una passkey. Una passkey si puo' rimuovere solo se ne resta almeno un'altra. */
export function canRemovePasskey(passkeyCount: number): boolean {
  return passkeyCount > 1;
}

export type UserAgentSummary = { browser: string | null; os: string | null };

/** Descrizione sintetica di uno user agent (browser e sistema). `null` = non riconosciuto: il testo lo sceglie l'interfaccia. */
export function describeUserAgent(userAgent: string | null | undefined): UserAgentSummary {
  const ua = userAgent ?? "";
  if (!ua) return { browser: null, os: null };

  // L'ordine conta: Edge e Opera contengono anche "Chrome", Chrome contiene anche "Safari".
  let browser: string | null = null;
  if (/\bEdgA?\/|\bEdgiOS\//.test(ua)) browser = "Edge";
  else if (/\bOPR\/|\bOpera\b/.test(ua)) browser = "Opera";
  else if (/\bFirefox\/|\bFxiOS\//.test(ua)) browser = "Firefox";
  else if (/\bSamsungBrowser\//.test(ua)) browser = "Samsung Internet";
  else if (/\bChrome\/|\bCriOS\//.test(ua)) browser = "Chrome";
  else if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) browser = "Safari";

  let os: string | null = null;
  if (/\bWindows\b/.test(ua)) os = "Windows";
  else if (/\bAndroid\b/.test(ua)) os = "Android";
  else if (/\b(iPhone|iPad|iPod)\b/.test(ua)) os = "iOS";
  else if (/\bCrOS\b/.test(ua)) os = "ChromeOS";
  else if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) os = "macOS";
  else if (/\bLinux\b|\bX11\b/.test(ua)) os = "Linux";

  return { browser, os };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/;

/** Espande un indirizzo IPv6 in 8 gruppi; `null` se non e' un IPv6 ben formato. */
function expandIpv6(address: string): string[] | null {
  if (!/^[0-9a-f:]+$/i.test(address) || address.split("::").length > 2) return null;
  const [head = "", tail] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail === undefined ? [] : tail ? tail.split(":") : [];
  if (tail === undefined) return headGroups.length === 8 ? headGroups : null;
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 1) return null;
  return [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
}

/**
 * Indirizzo IP con la parte finale nascosta: IPv4 senza l'ultimo ottetto (`198.51.100.x`), IPv6 con solo i primi 4 gruppi
 * (la rete, `2001:db8:1:2:…`). Un valore non riconosciuto non si mostra affatto.
 */
export function maskIpAddress(ip: string | null | undefined): string | null {
  const value = (ip ?? "").trim();
  if (!value) return null;
  const v4 = IPV4.exec(value);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/i.exec(value);
  if (mapped) return `${mapped[1]}.x`;
  const groups = expandIpv6(value);
  if (groups) return `${groups.slice(0, 4).join(":")}:…`;
  return null;
}
