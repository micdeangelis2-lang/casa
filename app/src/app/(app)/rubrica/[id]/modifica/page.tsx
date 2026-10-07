import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getParty } from "@/modules/directory";
import { isUuid } from "@/lib/ids";
import { CompetenceSection } from "../../_components/competence-section";
import { PartyForm } from "../../_components/party-form";
import { savePartyAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("directory.form");
  return { title: t("titleEdit") };
}

export default async function EditPartyPage({ params }: PageProps<"/rubrica/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const party = await getParty(getDb(), id);
  if (!party) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PartyForm
        mode="edit"
        partyId={id}
        archived={party.archived}
        initial={{
          displayName: party.displayName,
          roles: party.roles,
          taxCode: party.taxCode ?? "",
          email: party.email ?? "",
          pec: party.pec ?? "",
          phone: party.phone ?? "",
          address: party.address ?? "",
          notes: party.notes ?? "",
        }}
        onSubmit={savePartyAction.bind(null, id)}
      />
      <CompetenceSection partyId={id} />
    </div>
  );
}
