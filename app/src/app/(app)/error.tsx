"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Errore imprevisto in una pagina dell'area riservata. Non mostra il messaggio dell'errore (potrebbe contenere dati):
 * solo il codice (`digest`) con cui lo si ritrova nei log del server.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("problems.failure");
  return (
    <div role="alert" className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-lg border border-dashed p-10 text-center" data-testid="app-error">
      <TriangleAlert className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      {error.digest ? <p className="font-mono text-xs text-muted-foreground">{t("code", { digest: error.digest })}</p> : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={reset}>
          {t("retry")}
        </Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
