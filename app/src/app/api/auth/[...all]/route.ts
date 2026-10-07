import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/platform/auth/auth";

// L'istanza di Better Auth si crea alla prima richiesta, non al caricamento del modulo.
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
