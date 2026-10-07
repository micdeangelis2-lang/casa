import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getCondominiumDetail } from "@/modules/condominium";
import { isUuid } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/components/action-button";
import { archiveCondominiumAction } from "../actions";
import { AnagraficaSection } from "../_components/section-anagrafica";
import { MillesimiSection } from "../_components/section-millesimi";
import { EserciziSection } from "../_components/section-esercizi";
import { AssembleeSection } from "../_components/section-assemblee";
import { LavoriSection } from "../_components/section-lavori";
import { SegnalazioniSection } from "../_components/section-segnalazioni";
import { ContrattiSection } from "../_components/section-contratti";
import { DocumentiSection } from "../_components/section-documenti";

type Props = PageProps<"/condominio/[id]">;

const SECTIONS = ["anagrafica", "millesimi", "esercizi", "assemblee", "lavori", "segnalazioni", "contratti", "documenti"] as const;
type Section = (typeof SECTIONS)[number];

async function load(id: string) {
  if (!isUuid(id)) return null;
  return getCondominiumDetail(getDb(), id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await load((await params).id))?.name ?? "Condominio" };
}

export default async function CondominiumPage({ params, searchParams }: Props) {
  await requireOwner();
  const { id } = await params;
  const condo = await load(id);
  if (!condo) notFound();
  const t = await getTranslations("condominium");
  const td = await getTranslations("condominium.details");
  const raw = (await searchParams).sezione;
  const asked = Array.isArray(raw) ? raw[0] : raw;
  const section: Section = (SECTIONS as readonly string[]).includes(asked ?? "") ? (asked as Section) : "anagrafica";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{condo.name}</h1>
          <div className="flex flex-wrap gap-2">
            {condo.archived ? <Badge variant="outline">{t("archivedBadge")}</Badge> : null}
            <Badge variant="secondary">{t("members", { count: condo.members.length })}</Badge>
            {condo.administratorName ? <Badge variant="outline">{t("administrator", { name: condo.administratorName })}</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href={`/condominio/${condo.id}/modifica`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden /> {td("edit")}
          </Link>
          <ActionButton variant="outline" size="default" action={archiveCondominiumAction.bind(null, condo.id, !condo.archived)}>
            {condo.archived ? td("restore") : td("archive")}
          </ActionButton>
        </div>
      </div>

      <nav aria-label={t("sectionsLabel")} className="print:hidden">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <li key={s}>
              <Link href={`/condominio/${condo.id}?sezione=${s}`} aria-current={s === section ? "page" : undefined} className={cn(buttonVariants({ variant: s === section ? "secondary" : "outline", size: "sm" }), s === section && "font-semibold")}>
                {t(`sections.${s}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {section === "anagrafica" ? <AnagraficaSection condo={condo} /> : null}
      {section === "millesimi" ? <MillesimiSection condo={condo} /> : null}
      {section === "esercizi" ? <EserciziSection condo={condo} /> : null}
      {section === "assemblee" ? <AssembleeSection condo={condo} /> : null}
      {section === "lavori" ? <LavoriSection condo={condo} /> : null}
      {section === "segnalazioni" ? <SegnalazioniSection condo={condo} /> : null}
      {section === "contratti" ? <ContrattiSection condo={condo} /> : null}
      {section === "documenti" ? <DocumentiSection condo={condo} /> : null}
    </div>
  );
}
