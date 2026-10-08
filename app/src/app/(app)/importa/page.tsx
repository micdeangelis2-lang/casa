import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { ImportForm } from "./import-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("import");
  return { title: t("title") };
}

export default async function ImportPage() {
  await requireOwner();
  const t = await getTranslations("import");
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <ImportForm />
    </div>
  );
}
