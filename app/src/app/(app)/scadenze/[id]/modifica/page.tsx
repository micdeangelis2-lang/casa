import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getDeadlineDetail } from "@/modules/deadlines";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { deadlineSections, deadlineValues } from "../../_components/deadline-form-data";
import { saveDeadlineAction, saveOwnerFieldsAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("deadlines.form");
  return { title: t("titleEdit") };
}

export default async function EditDeadlinePage({ params }: PageProps<"/scadenze/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getDeadlineDetail(getDb(), id);
  if (!detail) notFound();
  const tf = await getTranslations("deadlines.form");
  const fromRule = detail.deadline.origin === "rule";

  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm
        title={tf("titleEdit")}
        sections={await deadlineSections({ ownerFieldsOnly: fromRule })}
        initial={deadlineValues(detail.deadline)}
        submitLabel={tf("submitEdit")}
        onSubmit={fromRule ? saveOwnerFieldsAction.bind(null, id) : saveDeadlineAction.bind(null, id)}
        cancelHref={`/scadenze/${id}`}
      />
    </div>
  );
}
