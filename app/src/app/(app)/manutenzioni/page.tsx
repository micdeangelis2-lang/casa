import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { requireOwner } from "@/platform/auth/owner";
import { cn } from "@/lib/utils";
import { SectionWorks } from "./_components/section-works";
import { SectionWarranties } from "./_components/section-warranties";
import { SectionInspections } from "./_components/section-inspections";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("maintenance");
  return { title: t("title") };
}

const SECTIONS = ["works", "warranties", "inspections"] as const;
type Section = (typeof SECTIONS)[number];
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function MaintenancePage({ searchParams }: PageProps<"/manutenzioni">) {
  await requireOwner();
  const t = await getTranslations("maintenance");
  const tPlants = await getTranslations("impiantista");
  const params = await searchParams;
  const section: Section = (SECTIONS as readonly string[]).includes(first(params.sezione)) ? (first(params.sezione) as Section) : "works";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/manutenzioni/impianti" className={buttonVariants({ variant: "outline" })}>
            {tPlants("title")}
          </Link>
          <Link href="/manutenzioni/nuovo" className={buttonVariants()}>
            <Plus aria-hidden /> {t("add")}
          </Link>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <nav aria-label={t("sectionsLabel")}>
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <li key={s}>
              <Link href={s === "works" ? "/manutenzioni" : `/manutenzioni?sezione=${s}`} aria-current={s === section ? "page" : undefined} className={cn(buttonVariants({ variant: s === section ? "secondary" : "outline", size: "sm" }), s === section && "font-semibold")}>
                {t(`sections.${s}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {section === "works" ? <SectionWorks params={params} /> : null}
      {section === "warranties" ? <SectionWarranties /> : null}
      {section === "inspections" ? <SectionInspections /> : null}
    </div>
  );
}
