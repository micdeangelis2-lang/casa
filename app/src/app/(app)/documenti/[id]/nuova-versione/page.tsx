import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getDocumentDetail } from "@/modules/documents";
import { isUuid } from "@/lib/ids";
import { DocumentForm } from "../../_components/document-form";
import { loadDocumentFormOptions } from "../../_components/form-options";
import { addVersionAction } from "../../actions";
import { emptyDocumentForm } from "../../document-form-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents.detail");
  return { title: t("addVersion") };
}

export default async function NewVersionPage({ params }: PageProps<"/documenti/[id]/nuova-versione">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getDocumentDetail(getDb(), id);
  if (!detail) notFound();
  const t = await getTranslations("documents.detail");
  const options = await loadDocumentFormOptions();
  const current = detail.versions[0]!;

  // Parte dall'emittente della versione corrente; le date sono della nuova versione e si compilano da capo.
  const initial = emptyDocumentForm({ issuerPartyId: current.issuerPartyId ?? "" });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <DocumentForm
        mode="version"
        heading={`${t("addVersion")}: ${detail.title}`}
        initial={initial}
        {...options}
        onSubmit={addVersionAction.bind(null, id)}
        cancelHref={`/documenti/${id}`}
      />
      <p className="text-sm text-muted-foreground">{t("addVersionIntro")}</p>
    </div>
  );
}
