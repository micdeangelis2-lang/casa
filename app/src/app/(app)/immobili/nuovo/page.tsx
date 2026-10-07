import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { AssetForm } from "../_components/asset-form";
import { loadAssetFormOptions } from "../_components/form-loader";
import { saveAssetAction } from "../actions";
import { emptyAssetForm } from "../asset-form-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assets.form");
  return { title: t("titleNew") };
}

export default async function NewAssetPage() {
  await requireOwner();
  const options = await loadAssetFormOptions();
  return (
    <div className="mx-auto max-w-3xl">
      <AssetForm
        mode="create"
        initial={emptyAssetForm()}
        {...options}
        onSubmit={saveAssetAction.bind(null, null)}
        cancelHref="/immobili"
      />
    </div>
  );
}
