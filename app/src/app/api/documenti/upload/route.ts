import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { MAX_FILE_BYTES } from "@/modules/documents/client";
import { directUploadEnabled, isStagingKey } from "@/lib/staged-upload";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * Rilascia al browser del proprietario un token per caricare UN file in `staging/<uuid>` sullo store Blob privato (caricamento
 * diretto: su Vercel il corpo di una richiesta non supera ~4,5 MB). Il token vale per quel solo percorso, con tetto di
 * `MAX_FILE_BYTES`, senza suffisso casuale e senza sovrascrittura. Non si registra `onUploadCompleted`: nessuna richiamata
 * dall'esterno (che non avrebbe la sessione); il file lo rilegge la azione del server e poi lo cancella.
 */
export async function POST(request: Request) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });
  if (!directUploadEnabled()) return new NextResponse(null, { status: 404 });

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (body?.type !== "blob.generate-client-token") return new NextResponse(null, { status: 400 });

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!isStagingKey(pathname)) throw new Error("Percorso non ammesso");
        return { maximumSizeInBytes: MAX_FILE_BYTES, addRandomSuffix: false, allowOverwrite: false };
      },
    });
    return NextResponse.json(result, { headers: noStore });
  } catch {
    return new NextResponse(null, { status: 400 });
  }
}
