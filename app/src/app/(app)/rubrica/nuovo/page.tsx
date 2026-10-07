import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { PartyForm } from "../_components/party-form";
import { emptyPartyForm } from "../party-form-state";
import { savePartyAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("directory.form");
  return { title: t("titleNew") };
}

export default async function NewPartyPage() {
  await requireOwner();
  return (
    <div className="mx-auto max-w-3xl">
      <PartyForm mode="create" initial={emptyPartyForm()} onSubmit={savePartyAction.bind(null, null)} />
    </div>
  );
}
