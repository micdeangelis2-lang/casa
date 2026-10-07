import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { isUuid } from "@/lib/ids";
import { DocumentForm } from "../_components/document-form";
import { loadDocumentFormOptions } from "../_components/form-options";
import { saveDocumentAction } from "../actions";
import { emptyDocumentForm } from "../document-form-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents.form");
  return { title: t("titleNew") };
}

export default async function NewDocumentPage({ searchParams }: PageProps<"/documenti/nuovo">) {
  await requireOwner();
  const options = await loadDocumentFormOptions();
  // `?bene=<id>` arriva dalla scheda di un immobile: parte gia' collegato a quel bene.
  const { bene } = await searchParams;
  const assetId = typeof bene === "string" && isUuid(bene) && options.assets.some((a) => a.id === bene) ? bene : null;
  // Categoria "Altro" come punto di partenza: e' sempre l'ultima della lista e la meno impegnativa.
  const initial = emptyDocumentForm({ assetIds: assetId ? [assetId] : [], categoryId: options.categories.at(-1)?.id ?? "" });

  return (
    <div className="mx-auto max-w-3xl">
      <DocumentForm mode="create" initial={initial} {...options} onSubmit={saveDocumentAction.bind(null, null)} cancelHref="/documenti" />
    </div>
  );
}
