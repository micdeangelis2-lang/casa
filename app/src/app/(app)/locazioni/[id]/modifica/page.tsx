import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getLettingDetail } from "@/modules/lettings";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { lettingSections, lettingValues } from "../../_components/letting-form-data";
import { saveLettingAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("lettings.form");
  return { title: t("titleEdit") };
}

export default async function EditLettingPage({ params }: PageProps<"/locazioni/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const letting = await getLettingDetail(getDb(), id);
  if (!letting) notFound();
  const tf = await getTranslations("lettings.form");
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleEdit")} sections={await lettingSections(true)} initial={lettingValues(letting)} submitLabel={tf("submitEdit")} onSubmit={saveLettingAction.bind(null, id)} cancelHref={`/locazioni/${id}`} />
    </div>
  );
}
