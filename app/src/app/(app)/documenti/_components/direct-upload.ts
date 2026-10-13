import { upload } from "@vercel/blob/client";

/** Oltre questa soglia il file si carica a pezzi (multipart), con nuovi tentativi per ogni pezzo. */
const MULTIPART_FROM_BYTES = 4 * 1024 * 1024;

export type StagedUpload = { stagedKey: string; stagedName: string };

/**
 * Carica il file in `staging/<uuid>` sullo store Blob privato, direttamente dal browser (la route `/api/documenti/upload`
 * rilascia solo il token). Il percorso non contiene ne' il nome originale ne' l'estensione: il nome viaggia a parte, come
 * `stagedName`. Se il caricamento fallisce lancia un errore: chi chiama mostra il messaggio all'utente.
 */
export async function uploadToStaging(file: File, onProgress?: (percentage: number) => void): Promise<StagedUpload> {
  const stagedKey = `staging/${crypto.randomUUID()}`;
  await upload(stagedKey, file, {
    access: "private",
    handleUploadUrl: "/api/documenti/upload",
    contentType: "application/octet-stream",
    multipart: file.size > MULTIPART_FROM_BYTES,
    onUploadProgress: onProgress ? ({ percentage }) => onProgress(Math.round(percentage)) : undefined,
  });
  return { stagedKey, stagedName: file.name };
}
