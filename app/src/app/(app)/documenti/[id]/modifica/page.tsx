import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getDocumentDetail } from "@/modules/documents";
import { isUuid } from "@/lib/ids";
import { DocumentForm } from "../../_components/document-form";
import { loadDocumentFormOptions } from "../../_components/form-options";
import { saveDocumentAction } from "../../actions";
import { emptyDocumentForm } from "../../document-form-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents.form");
  return { title: t("titleEdit") };
}

export default async function EditDocumentPage({ params }: PageProps<"/documenti/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getDocumentDetail(getDb(), id);
  if (!detail) notFound();
  const options = await loadDocumentFormOptions();
  const current = detail.versions[0]!;

  const initial = emptyDocumentForm({
    title: detail.title,
    categoryId: detail.categoryId,
    confidentiality: detail.confidentiality,
    assetIds: detail.assets.map((a) => a.id),
    notes: detail.notes ?? "",
    issuerPartyId: current.issuerPartyId ?? "",
    issuedOn: current.issuedOn ?? "",
    validFrom: current.validFrom ?? "",
    validTo: current.validTo ?? "",
    verificationStatus: current.verificationStatus,
    note: current.note ?? "",
  });

  return (
    <div className="mx-auto max-w-3xl">
      <DocumentForm mode="edit" initial={initial} {...options} onSubmit={saveDocumentAction.bind(null, id)} cancelHref={`/documenti/${id}`} />
    </div>
  );
}
