import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { safeReturnPath } from "@/platform/auth/reconfirmation";
import { hasRecentReconfirmation } from "@/platform/auth/recent-auth";
import { ReconfirmForm } from "./reconfirm-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reconfirm");
  return { title: t("title") };
}

/** Riconferma recente (F-04): serve prima di scaricare dati riservati o di cambiare le impostazioni di sicurezza. */
export default async function ReconfirmPage({ searchParams }: PageProps<"/riconferma">) {
  const owner = await requireOwner();
  const t = await getTranslations("reconfirm");
  const raw = (await searchParams).ritorno;
  // Solo percorsi interni (anti open redirect); qualunque altro valore ripiega sulla panoramica.
  const target = safeReturnPath(Array.isArray(raw) ? raw[0] : raw) ?? "/";
  const already = await hasRecentReconfirmation(owner);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <ReconfirmForm target={target} already={already} />
    </div>
  );
}
