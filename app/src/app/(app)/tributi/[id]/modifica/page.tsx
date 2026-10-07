import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getObligationDetail } from "@/modules/taxes";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { obligationSections, obligationValues } from "../../_components/obligation-form-data";
import { saveObligationAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.form");
  return { title: t("titleEdit") };
}

export default async function EditObligationPage({ params }: PageProps<"/tributi/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const obligation = await getObligationDetail(getDb(), id);
  if (!obligation) notFound();
  const tf = await getTranslations("taxes.form");
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleEdit")} sections={await obligationSections(true, obligation)} initial={obligationValues(obligation)} submitLabel={tf("submitEdit")} onSubmit={saveObligationAction.bind(null, id)} cancelHref={`/tributi/${id}`} />
    </div>
  );
}
