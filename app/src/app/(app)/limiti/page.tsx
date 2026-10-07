import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { PrintButton } from "@/components/print-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("limits");
  return { title: t("title") };
}

const AREAS = ["dossier", "deadlines", "condominium", "taxes", "maintenance", "insurance", "lettings", "matters"] as const;

/** I limiti dell'assistenza (sezione 12 della specifica), sempre raggiungibili dalla barra laterale. */
export default async function LimitsPage() {
  await requireOwner();
  const t = await getTranslations("limits");
  const list = (key: "never.items" | "professional.items" | "wording.items") => t.raw(key) as string[];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit print:hidden"}>
        <ArrowLeft aria-hidden /> {t("back")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <PrintButton />
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("never.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>{t("never.intro")}</p>
          <ul className="list-disc pl-5" data-testid="never-list">
            {list("never.items").map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">{t("never.outro")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("professional.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>{t("professional.intro")}</p>
          <ul className="list-disc pl-5" data-testid="professional-list">
            {list("professional.items").map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">{t("professional.outro")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("wording.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>{t("wording.intro")}</p>
          <ul className="list-disc pl-5">
            {list("wording.items").map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <section aria-labelledby="areas-heading" className="flex flex-col gap-3">
        <h2 id="areas-heading" className="text-lg font-medium">
          {t("areas.heading")}
        </h2>
        <dl className="flex flex-col gap-3 text-sm" data-testid="areas">
          {AREAS.map((area) => (
            <div key={area} className="flex flex-col gap-1 rounded-lg border p-4">
              <dt className="font-medium">{t(`areas.${area}.name`)}</dt>
              <dd className="text-muted-foreground">{t(`areas.${area}.text`)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
