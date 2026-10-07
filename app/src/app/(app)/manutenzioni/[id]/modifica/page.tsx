import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getWorkDetail } from "@/modules/maintenance";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { workSections, workValues } from "../../_components/work-form-data";
import { saveWorkAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("maintenance.form");
  return { title: t("titleEdit") };
}

export default async function EditWorkPage({ params }: PageProps<"/manutenzioni/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const work = await getWorkDetail(getDb(), id);
  if (!work) notFound();
  const tf = await getTranslations("maintenance.form");
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleEdit")} sections={await workSections(true)} initial={workValues(work)} submitLabel={tf("submitEdit")} onSubmit={saveWorkAction.bind(null, id)} cancelHref={`/manutenzioni/${id}`} />
    </div>
  );
}
