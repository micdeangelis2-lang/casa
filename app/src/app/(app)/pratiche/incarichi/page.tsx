import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { EditInline } from "@/components/edit-inline";
import { InlineForm } from "@/components/inline-form";
import type { FieldSpec } from "@/components/simple-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { listDocumentOptions } from "@/modules/documents";
import { DELIVERABLE_DIRECTIONS, ENGAGEMENT_STATUSES, groupByProfessional, listEngagements } from "@/modules/engagements";
import { listMatters } from "@/modules/matters";
import { formatDate, formatEuro } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { addDeliverableAction, createEngagementAction, removeDeliverableAction, setEngagementStatusAction, updateEngagementAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("engagements");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function EngagementsPage({ searchParams }: PageProps<"/pratiche/incarichi">) {
  await requireOwner();
  const t = await getTranslations("engagements");
  const params = await searchParams;
  const partyId = isUuid(first(params.professionista)) ? first(params.professionista) : undefined;
  const db = getDb();
  const [items, parties, assets, matters, documents] = await Promise.all([listEngagements(db, { partyId }), listParties(db), listAssets(db), listMatters(db, { includeClosed: true }), listDocumentOptions(db)]);
  const groups = groupByProfessional(items);
  const statusOptions = ENGAGEMENT_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }));

  const fields = (documentOptions: { value: string; label: string }[]): FieldSpec[] => [
    { kind: "select", name: "partyId", label: t("form.party"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: t("form.chooseParty") },
    { kind: "text", name: "subject", label: t("form.subject"), maxLength: 200 },
    { kind: "date", name: "engagedOn", label: t("form.engagedOn") },
    { kind: "text", name: "declaredFee", label: t("form.fee"), inputMode: "decimal", maxLength: 14 },
    { kind: "select", name: "status", label: t("form.status"), options: statusOptions },
    { kind: "select", name: "assetId", label: t("form.asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: t("form.noAsset") },
    { kind: "select", name: "matterId", label: t("form.matter"), options: matters.map((m) => ({ value: m.id, label: m.title })), emptyLabel: t("form.noMatter") },
    { kind: "select", name: "documentId", label: t("form.document"), options: documentOptions, emptyLabel: t("form.noDocument") },
    { kind: "text", name: "note", label: t("form.note"), maxLength: 500 },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Link href="/pratiche" className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit"}>
        <ArrowLeft aria-hidden /> {t("title")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>

      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex w-64 flex-col gap-2">
          <Label htmlFor="professionista">{t("filterLabel")}</Label>
          <NativeSelect id="professionista" name="professionista" defaultValue={partyId ?? ""}>
            <option value="">{t("filterAll")}</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary">
          {t("filterApply")}
        </Button>
      </form>

      {groups.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <div className="flex flex-col gap-6" data-testid="engagement-groups">
        {groups.map((g) => (
          <section key={g.partyId} aria-labelledby={`g-${g.partyId}`} className="flex flex-col gap-3" data-testid="engagement-group">
            <h2 id={`g-${g.partyId}`} className="text-lg font-medium">
              {g.partyName} <span className="text-sm font-normal text-muted-foreground">({t("groupCount", { count: g.items.length })})</span>
            </h2>
            <ul className="flex flex-col gap-4">
              {g.items.map((e) => (
                <li key={e.id} className="flex flex-col gap-3 rounded-lg border p-4 text-sm" data-testid="engagement">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{e.subject}</h3>
                    <Badge variant={e.open ? "secondary" : "outline"}>{t(`status.${e.status}`)}</Badge>
                  </div>
                  <p className="text-muted-foreground">
                    {[t("engagedOn", { date: formatDate(e.engagedOn) }), e.declaredFeeCents === null ? t("noFee") : t("fee", { amount: formatEuro(e.declaredFeeCents) })].join(" · ")}
                  </p>
                  <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[10rem_1fr]">
                    {e.assetId && e.assetName ? (
                      <>
                        <dt className="text-muted-foreground">{t("asset")}</dt>
                        <dd>
                          <Link href={`/immobili/${e.assetId}`} className="underline underline-offset-2">
                            {e.assetName}
                          </Link>
                        </dd>
                      </>
                    ) : null}
                    {e.matterId && e.matterTitle ? (
                      <>
                        <dt className="text-muted-foreground">{t("matter")}</dt>
                        <dd>
                          <Link href={`/pratiche/${e.matterId}`} className="underline underline-offset-2">
                            {e.matterTitle}
                          </Link>
                        </dd>
                      </>
                    ) : null}
                    {e.documentId && e.documentTitle ? (
                      <>
                        <dt className="text-muted-foreground">{t("letter")}</dt>
                        <dd>
                          <Link href={`/documenti/${e.documentId}`} className="underline underline-offset-2">
                            {e.documentTitle}
                          </Link>
                        </dd>
                      </>
                    ) : null}
                    {e.note ? (
                      <>
                        <dt className="text-muted-foreground">{t("form.note")}</dt>
                        <dd className="whitespace-pre-wrap">{e.note}</dd>
                      </>
                    ) : null}
                  </dl>

                  <div className="flex flex-col gap-1">
                    <h4 className="font-medium">{t("deliverables")}</h4>
                    {e.deliverables.length === 0 ? <p className="text-muted-foreground">{t("noDeliverables")}</p> : null}
                    <ul className="flex flex-col divide-y" data-testid="deliverables">
                      {e.deliverables.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0" data-direction={d.direction}>
                          <Badge variant="outline">{t(`direction.${d.direction}`)}</Badge>
                          <span>{t("deliverableLine", { kind: d.kindLabel, date: formatDate(d.occurredOn) })}</span>
                          {d.documentId && d.documentTitle ? (
                            <Link href={`/documenti/${d.documentId}`} className="underline underline-offset-2">
                              {d.documentTitle}
                            </Link>
                          ) : null}
                          <ActionButton action={removeDeliverableAction.bind(null, d.id)} srLabel={d.kindLabel}>
                            {t("remove")}
                          </ActionButton>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <InlineForm
                    idPrefix={`deliverable-${e.id}`}
                    title={t("deliverable.title", { subject: e.subject })}
                    fields={[
                      { kind: "select", name: "direction", label: t("deliverable.direction"), options: DELIVERABLE_DIRECTIONS.map((d) => ({ value: d, label: t(`direction.${d}`) })) },
                      { kind: "text", name: "kindLabel", label: t("deliverable.kind"), maxLength: 120 },
                      { kind: "date", name: "occurredOn", label: t("deliverable.date") },
                      { kind: "select", name: "documentId", label: t("deliverable.document"), options: documents, emptyLabel: t("deliverable.noDocument") },
                      { kind: "text", name: "note", label: t("deliverable.note"), maxLength: 500 },
                    ]}
                    initial={{ direction: "received", kindLabel: "", occurredOn: "", documentId: "", note: "" }}
                    submitLabel={t("deliverable.submit")}
                    onSubmit={addDeliverableAction.bind(null, e.id)}
                  />
                  <div className="flex flex-wrap gap-4">
                    <InlineForm
                      key={`${e.id}-${e.status}`}
                      idPrefix={`status-${e.id}`}
                      title={`${t("setStatus")}: ${e.subject}`}
                      fields={[{ kind: "select", name: "status", label: t("statusLabel"), options: statusOptions }]}
                      initial={{ status: e.status }}
                      submitLabel={t("setStatus")}
                      onSubmit={setEngagementStatusAction.bind(null, e.id)}
                    />
                    <EditInline
                      idPrefix={`edit-${e.id}`}
                      title={t("edit.title", { subject: e.subject })}
                      openLabel={t("edit.open")}
                      cancelLabel={t("edit.cancel")}
                      srLabel={e.subject}
                      submitLabel={t("edit.save")}
                      fields={fields(e.documentId && e.documentTitle && !documents.some((d) => d.value === e.documentId) ? [{ value: e.documentId, label: e.documentTitle }, ...documents] : documents)}
                      initial={{
                        partyId: e.partyId,
                        subject: e.subject,
                        engagedOn: e.engagedOn,
                        declaredFee: e.declaredFeeCents === null ? "" : formatEuro(e.declaredFeeCents),
                        status: e.status,
                        assetId: e.assetId ?? "",
                        matterId: e.matterId ?? "",
                        documentId: e.documentId ?? "",
                        note: e.note ?? "",
                      }}
                      onSubmit={updateEngagementAction.bind(null, e.id)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {parties.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noParties")}</p>
      ) : (
        <InlineForm
          idPrefix="engagement"
          title={t("form.title")}
          fields={fields(documents)}
          initial={{ partyId: partyId ?? "", subject: "", engagedOn: "", declaredFee: "", status: "active", assetId: "", matterId: "", documentId: "", note: "" }}
          submitLabel={t("form.submit")}
          onSubmit={createEngagementAction}
        />
      )}
    </div>
  );
}
