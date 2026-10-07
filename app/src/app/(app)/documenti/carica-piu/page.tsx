import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { loadDocumentFormOptions } from "../_components/form-options";
import { BulkUploadForm } from "./bulk-upload-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bulkUpload");
  return { title: t("title") };
}

export default async function BulkUploadPage() {
  await requireOwner();
  const { categories, assets } = await loadDocumentFormOptions();
  return (
    <div className="mx-auto max-w-3xl">
      <BulkUploadForm categories={categories} assets={assets} defaultCategoryId={categories.at(-1)?.id ?? ""} />
    </div>
  );
}
