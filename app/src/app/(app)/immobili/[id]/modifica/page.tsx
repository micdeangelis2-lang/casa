import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getAssetDetail } from "@/modules/assets";
import { isUuid } from "@/lib/ids";
import { AssetForm } from "../../_components/asset-form";
import { loadAssetFormOptions } from "../../_components/form-loader";
import { saveAssetAction } from "../../actions";
import { detailToFormState } from "../../asset-form-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assets.form");
  return { title: t("titleEdit") };
}

export default async function EditAssetPage({ params }: PageProps<"/immobili/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getAssetDetail(getDb(), id);
  if (!detail) notFound();
  const options = await loadAssetFormOptions(id);

  return (
    <div className="mx-auto max-w-3xl">
      <AssetForm
        mode="edit"
        initial={detailToFormState(detail)}
        {...options}
        onSubmit={saveAssetAction.bind(null, id)}
        cancelHref={`/immobili/${id}`}
      />
    </div>
  );
}
