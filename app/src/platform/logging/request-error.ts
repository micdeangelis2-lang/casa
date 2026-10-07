/**
 * Riga di log strutturata per gli errori del server (usata da `src/instrumentation.ts`).
 *
 * Regola ferrea: la riga contiene SOLO campi a lista bianca e ripuliti. Mai il messaggio, lo stack, il corpo,
 * le intestazioni, la query string o i parametri SQL: gli errori di Drizzle contengono la query con i valori
 * e un messaggio qualunque puo' contenere dati personali. Per questo non si copia nulla "per intero".
 */

export type RequestErrorLogContext = {
  /** Percorso come modello di route (es. `/immobili/[id]`), mai l'URL reale. */
  routePath?: string;
  routeType?: string;
};

export type RequestErrorLogRequest = { method?: string };

export type RequestErrorLine = {
  level: "error";
  time: string;
  /** Lo stesso codice che la pagina d'errore mostra all'utente. */
  digest: string | null;
  route: string | null;
  method: string | null;
  routeType: string | null;
  errorName: string;
  /** Codice SQLSTATE di Postgres (5 caratteri), se l'errore o una sua causa lo ha. */
  code?: string;
};

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const ROUTE_TYPES = new Set(["render", "route", "action", "proxy"]);
const DIGEST = /^[A-Za-z0-9_.:@-]{1,64}$/;
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_$]{0,59}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
/** Segmenti di un modello di route: lettere, cifre e i segni usati da Next (`[id]`, `[...slug]`, `(gruppo)`, `@slot`). */
const ROUTE = /^\/[A-Za-z0-9_\-./[\]()@,~]*$/;
const MAX_CAUSE_DEPTH = 5;

const pick = (value: unknown, allowed: Set<string>): string | null => (typeof value === "string" && allowed.has(value) ? value : null);

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  try {
    const value = (source as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Il primo codice SQLSTATE nella catena delle cause (Drizzle avvolge l'errore di `pg` in `cause`). */
export function findPostgresCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== null && typeof current === "object"; depth += 1) {
    const code = readString(current, "code");
    if (code !== undefined && SQLSTATE.test(code)) return code;
    try {
      current = (current as { cause?: unknown }).cause;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** `name`, oppure il nome della classe quando `name` e' il generico «Error» (es. DrizzleQueryError). */
function errorName(error: unknown): string | undefined {
  const name = readString(error, "name");
  if (name !== undefined && name !== "Error") return name;
  if (typeof error !== "object" || error === null) return name;
  try {
    const ctor = (error as { constructor?: { name?: unknown } } | null)?.constructor;
    return typeof ctor?.name === "string" && ctor.name !== "Object" ? ctor.name : name;
  } catch {
    return name;
  }
}

export function formatRequestError(
  error: unknown,
  request: RequestErrorLogRequest,
  context: RequestErrorLogContext,
  now: Date = new Date(),
): RequestErrorLine {
  const digest = readString(error, "digest");
  const name = errorName(error);
  const method = typeof request.method === "string" ? request.method.toUpperCase() : undefined;
  const line: RequestErrorLine = {
    level: "error",
    time: now.toISOString(),
    digest: digest !== undefined && DIGEST.test(digest) ? digest : null,
    route: typeof context.routePath === "string" && ROUTE.test(context.routePath) && context.routePath.length <= 200 ? context.routePath : null,
    method: pick(method, METHODS),
    routeType: pick(context.routeType, ROUTE_TYPES),
    errorName: name !== undefined && ERROR_NAME.test(name) ? name : "Error",
  };
  const code = findPostgresCode(error);
  if (code !== undefined) line.code = code;
  return line;
}

export const serializeRequestError = (line: RequestErrorLine): string => JSON.stringify(line);
