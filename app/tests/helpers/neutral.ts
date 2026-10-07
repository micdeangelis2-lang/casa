/**
 * Controllo del linguaggio neutro (sezione 12 della specifica): l'app non deve MAI affermare che un immobile sia conforme,
 * che un tributo non sia dovuto, che una delibera sia valida o non valida, che un'attivita' si possa avviare.
 * Il controllo e' volutamente prudente: segnala le frasi che sembrano un verdetto. Una frase che contiene una negazione
 * o un «se» (come «l'app non dice se un'attivita' e' in regola») e' un'avvertenza, non un verdetto.
 */

/** Una parola intera, anche con lettere accentate (`\b` di JavaScript non le vede come lettere). */
const word = (pattern: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, "iu");

/** Verdetti affermativi: ammessi solo dentro una frase negata o condizionale. */
const AFFIRMATIVE: RegExp[] = [
  word("(?:è|sono|risulta|risultano|sei|siete)\\s+(?:completamente\\s+|tutto\\s+)?(?:in regola|conform[ei]|a norma|regolar[ei]|legittim[aoie]|lecit[aoie]|valid[aoie]|invalid[aoie]|nulla|annullabile)"),
  word("(?:puoi|può|potete)\\s+(?:tranquillamente\\s+)?(?:avviare|iniziare|aprire|procedere)"),
  word("si può (?:avviare|iniziare|aprire)"),
  word("(?:tutto|tutta|tutti|tutte)\\s+(?:in regola|a posto)"),
];

/** Verdetti che non vanno MAI scritti, nemmeno negati («non è dovuto» e simili). */
const ALWAYS_FORBIDDEN: RegExp[] = [word("non è dovut[oaie]"), word("non (?:devi|dovrai|occorre) (?:pagare|presentare|versare)"), word("non sei tenut[oa]"), word("nessun obbligo")];

const HEDGE = word("non|mai|né|se|eventuale|eventuali");

const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?;:])\s+|\n+|\s{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** Le frasi del testo che sembrano un verdetto conclusivo (vuoto se il testo e' neutro). */
export function conclusiveClaims(text: string): string[] {
  return sentences(text).filter((s) => ALWAYS_FORBIDDEN.some((re) => re.test(s)) || (AFFIRMATIVE.some((re) => re.test(s)) && !HEDGE.test(s)));
}
