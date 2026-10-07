import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { deadlineSections, deadlineValues } from "../_components/deadline-form-data";
import { saveDeadlineAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("deadlines.form");
  return { title: t("titleNew") };
}

export default async function NewDeadlinePage({ searchParams }: PageProps<"/scadenze/nuova">) {
  await requireOwner();
  const tf = await getTranslations("deadlines.form");
  const { immobile, professionista, pratica } = await searchParams;
  const assetId = typeof immobile === "string" && isUuid(immobile) ? immobile : undefined;
  const professionalPartyId = typeof professionista === "string" && isUuid(professionista) ? professionista : undefined;
  const matterId = typeof pratica === "string" && isUuid(pratica) ? pratica : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm
        title={tf("titleNew")}
        intro={tf("intro")}
        sections={await deadlineSections()}
        initial={deadlineValues(undefined, { assetId, professionalPartyId, matterId })}
        submitLabel={tf("submitNew")}
        onSubmit={saveDeadlineAction.bind(null, null)}
        cancelHref="/scadenze"
      />
    </div>
  );
}
