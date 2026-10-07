import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getMatterDetail } from "@/modules/matters";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { matterSections, matterValues } from "../../_components/matter-form-data";
import { saveMatterAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("matters.form");
  return { title: t("titleEdit") };
}

export default async function EditMatterPage({ params }: PageProps<"/pratiche/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getMatterDetail(getDb(), id);
  if (!detail) notFound();
  const tf = await getTranslations("matters.form");
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleEdit")} sections={await matterSections()} initial={matterValues(detail)} submitLabel={tf("submitEdit")} onSubmit={saveMatterAction.bind(null, id)} cancelHref={`/pratiche/${id}`} />
    </div>
  );
}
