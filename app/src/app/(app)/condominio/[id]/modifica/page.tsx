import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getCondominiumDetail } from "@/modules/condominium";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { condoSections, condoValues } from "../../_components/condo-form-data";
import { saveCondominiumAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("condominium.form");
  return { title: t("titleEdit") };
}

export default async function EditCondominiumPage({ params }: PageProps<"/condominio/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const condo = await getCondominiumDetail(getDb(), id);
  if (!condo) notFound();
  const tf = await getTranslations("condominium.form");
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleEdit")} sections={await condoSections()} initial={condoValues(condo)} submitLabel={tf("submitEdit")} onSubmit={saveCondominiumAction.bind(null, id)} cancelHref={`/condominio/${id}`} />
    </div>
  );
}
