import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileQuestion } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** «Pagina non trovata» in italiano, con la via di ritorno. Il codice di stato 404 lo dà Next. */
export async function NotFoundCard() {
  const t = await getTranslations("problems.notFound");
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-lg border border-dashed p-10 text-center" data-testid="not-found">
      <FileQuestion className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      <Link href="/" className={buttonVariants()}>
        {t("home")}
      </Link>
    </div>
  );
}
