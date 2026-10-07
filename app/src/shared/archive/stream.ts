import { createHash } from "node:crypto";

/** Trasforma un generatore asincrono in un flusso web (per le risposte HTTP). Se il client chiude, il generatore si ferma. */
export function toWebStream(source: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await source.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await source.return(undefined);
    },
  });
}

/** Legge un flusso web come sequenza di pezzi (i flussi web non sono ancora tipizzati come iterabili asincroni). */
export async function* fromWebStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Legge un file a pezzi e ne verifica l'impronta SHA-256 alla fine: un file alterato fa fallire il flusso. */
export async function* verifiedStream(stream: ReadableStream<Uint8Array>, label: string, expectedSha256: string): AsyncGenerator<Uint8Array> {
  const hash = createHash("sha256");
  for await (const part of fromWebStream(stream)) {
    hash.update(part);
    yield part;
  }
  if (hash.digest("hex") !== expectedSha256) throw new Error(`Il file ${label} nello storage non corrisponde piu' alla sua impronta`);
}
