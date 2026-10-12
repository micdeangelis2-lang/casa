import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ActionButton } from "@/components/action-button";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listTaxTypes } from "@/modules/taxes";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { obligationSections, obligationValues } from "../_components/obligation-form-data";
import { saveObligationAction, seedTaxTypesAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.form");
  return { title: t("titleNew") };
}

export default async function NewObligationPage({ searchParams }: PageProps<"/tributi/nuovo">) {
  await requireOwner();
  const tf = await getTranslations("taxes.form");
  const tt = await getTranslations("taxes.types");
  const { immobile } = await searchParams;
  const assetId = typeof immobile === "string" && isUuid(immobile) ? immobile : undefined;
  const db = getDb();
  const types = await listTaxTypes(db);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {types.length === 0 ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{tf("noTypesWarning")}</span>
            <ActionButton action={seedTaxTypesAction} size="sm">
              {tt("seedButton")}
            </ActionButton>
          </AlertDescription>
        </Alert>
      ) : null}
      <SimpleForm
        title={tf("titleNew")}
        sections={await obligationSections(false)}
        initial={obligationValues(undefined, { assetId })}
        submitLabel={tf("submitNew")}
        onSubmit={saveObligationAction.bind(null, null)}
        cancelHref="/tributi"
      />
    </div>
  );
}
