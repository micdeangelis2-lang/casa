import { formatRequestError, serializeRequestError, type RequestErrorLogContext, type RequestErrorLogRequest } from "./request-error";

/**
 * Scrive su stderr la riga JSON dell'errore. Sta in un file a parte, caricato solo dal runtime Node, perche' usa `process.stderr`:
 * dentro `instrumentation.ts` il bundler lo segnalerebbe anche per il runtime edge.
 */
export function writeRequestError(error: unknown, request: RequestErrorLogRequest, context: RequestErrorLogContext): void {
  process.stderr.write(`${serializeRequestError(formatRequestError(error, request, context))}\n`);
}
