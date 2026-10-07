import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { InlineForm } from "@/components/inline-form";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { listDocumentOptions } from "@/modules/documents";
import { ActionButton } from "@/components/action-button";
import { listMandates } from "@/modules/management";
import { formatDate } from "@/lib/format";
import { GestoreTable } from "../_components/gestore-table";
import { archiveMandateAction, createMandateAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gestore.mandates");
  return { title: t("title") };
}

export default async function MandatesPage() {
  await requireOwner();
  const t = await getTranslations("gestore.mandates");
  const db = getDb();
  const [mandates, assets, parties, documents] = await Promise.all([listMandates(db), listAssets(db), listParties(db), listDocumentOptions(db)]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>

      <section aria-labelledby="list-heading" className="flex flex-col gap-2">
        <h2 id="list-heading" className="text-lg font-medium">
          {t("listHeading")}
        </h2>
        {mandates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <GestoreTable
            label={t("listHeading")}
            testId="mandates-list"
            headers={[t("manager"), t("asset"), t("ends"), t("compensation"), t("state"), ""]}
            rows={mandates.map((m) => ({
              key: m.id,
              cells: [
                m.deadlineId ? (
                  <Link key="l" href={`/scadenze/${m.deadlineId}`} className="underline underline-offset-2">
                    {m.managerName ?? m.title}
                  </Link>
                ) : (
                  <span key="l">{m.managerName ?? m.title}</span>
                ),
                m.assetName ?? t("allAssets"),
                m.endsOn ? formatDate(m.endsOn) : "",
                m.compensation ?? "",
                <Badge key="b" variant={m.state === "expired" ? "destructive" : "secondary"}>
                  {t(`states.${m.state}`)}
                </Badge>,
                <ActionButton key="a" action={archiveMandateAction.bind(null, m.id)} srLabel={m.managerName ?? m.title}>
                  {t("archive")}
                </ActionButton>,
              ],
            }))}
          />
        )}
      </section>

      {parties.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noParties")}</p>
      ) : (
        <InlineForm
          idPrefix="mandate"
          title={t("form.title")}
          fields={[
            { kind: "select", name: "managerPartyId", label: t("form.manager"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: t("form.chooseManager") },
            { kind: "select", name: "assetId", label: t("form.asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: t("form.allAssets") },
            { kind: "date", name: "startsOn", label: t("form.startsOn") },
            { kind: "date", name: "endsOn", label: t("form.endsOn") },
            { kind: "text", name: "compensation", label: t("form.compensation"), maxLength: 200 },
            { kind: "select", name: "documentId", label: t("form.document"), options: documents, emptyLabel: t("form.noDocument") },
            { kind: "text", name: "note", label: t("form.note"), maxLength: 500 },
          ]}
          initial={{ managerPartyId: "", assetId: "", startsOn: "", endsOn: "", compensation: "", documentId: "", note: "" }}
          submitLabel={t("form.submit")}
          onSubmit={createMandateAction}
        />
      )}
    </div>
  );
}
