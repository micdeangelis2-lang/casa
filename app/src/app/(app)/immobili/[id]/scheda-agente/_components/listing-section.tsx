import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/platform/db/client";
import { LISTING_EVENT_KINDS, LISTING_KINDS, LISTING_OUTCOMES, listEngagements } from "@/modules/agent";
import { listParties } from "@/modules/directory";
import { listDocumentOptions } from "@/modules/documents";
import { ActionButton } from "@/components/action-button";
import { EditInline } from "@/components/edit-inline";
import { InlineForm } from "@/components/inline-form";
import type { FieldSpec } from "@/components/simple-form";
import { formatDate, formatEuro } from "@/lib/format";
import { formatCents } from "@/shared/money";
import { addEngagementAction, addListingEventAction, removeEngagementAction, removeListingEventAction, setEngagementStatusAction, updateEngagementAction, updateListingEventAction } from "../actions";

/** Mandati di vendita o affitto di un immobile, con visite e proposte registrate dal proprietario (solo per lui: non va nella stampa). */
export async function ListingSection({ assetId }: { assetId: string }) {
  const t = await getTranslations("agente.listing");
  const te = await getTranslations("editUi");
  const db = getDb();
  const [engagements, parties, documents] = await Promise.all([listEngagements(db, assetId), listParties(db), listDocumentOptions(db)]);
  const partyOptions = parties.map((p) => ({ value: p.id, label: p.displayName }));
  /** Il documento collegato puo' non essere tra i piu' recenti: lo si aggiunge alle scelte, cosi' la modifica non lo perde. */
  const documentsWith = (current: { documentId: string | null; documentTitle: string | null }) =>
    current.documentId && current.documentTitle && !documents.some((d) => d.value === current.documentId) ? [{ value: current.documentId, label: current.documentTitle }, ...documents] : documents;

  const engagementFields = (documentOptions: { value: string; label: string }[]): FieldSpec[] =>
    [
      { kind: "select", name: "kind", label: t("kindLabel"), options: LISTING_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) })), emptyLabel: t("choose") },
      { kind: "select", name: "agentPartyId", label: t("agentLabel"), options: partyOptions, emptyLabel: t("none") },
      { kind: "date", name: "startsOn", label: t("startsOnLabel") },
      { kind: "date", name: "endsOn", label: t("endsOnLabel") },
      { kind: "checkbox", name: "exclusive", label: t("exclusiveLabel") },
      { kind: "text", name: "asking", label: t("askingLabel"), inputMode: "decimal", maxLength: 14 },
      { kind: "text", name: "commission", label: t("commissionLabel"), maxLength: 200 },
      { kind: "select", name: "documentId", label: t("documentLabel"), options: documentOptions, emptyLabel: t("none") },
      { kind: "textarea", name: "note", label: t("noteLabel"), maxLength: 1000 },
    ];

  const eventFields = (): FieldSpec[] =>
    [
      { kind: "select", name: "kind", label: t("eventKindLabel"), options: LISTING_EVENT_KINDS.map((k) => ({ value: k, label: t(`eventKind.${k}`) })), emptyLabel: t("choose") },
      { kind: "date", name: "occurredOn", label: t("eventDate") },
      { kind: "text", name: "amount", label: t("eventAmountLabel"), inputMode: "decimal", maxLength: 14 },
      { kind: "select", name: "outcome", label: t("eventOutcome"), options: LISTING_OUTCOMES.map((o) => ({ value: o, label: t(`outcome.${o}`) })), emptyLabel: t("none") },
      { kind: "select", name: "contactPartyId", label: t("eventContactLabel"), options: partyOptions, emptyLabel: t("none") },
      { kind: "text", name: "note", label: t("eventNote"), maxLength: 500 },
    ];

  return (
    <Card className="print:hidden" data-testid="agent-listings">
      <CardHeader>
        <CardTitle>
          <h2>{t("title")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p className="text-muted-foreground">{t("intro")}</p>
        {engagements.length === 0 ? <p data-testid="listings-empty">{t("empty")}</p> : null}
        <ul className="flex flex-col gap-4" data-testid="listing-list">
          {engagements.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 rounded-lg border p-3" data-testid="listing">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t(`kind.${e.kind}`)}</span>
                <Badge variant={e.status === "active" ? "secondary" : "outline"}>{t(`status.${e.status}`)}</Badge>
                {e.exclusive ? <Badge variant="outline">{t("exclusive")}</Badge> : null}
                {e.agentName ? <span>{t("agent", { name: e.agentName })}</span> : null}
                <ActionButton action={setEngagementStatusAction.bind(null, assetId, e.id, e.status === "active" ? "ended" : "active")} srLabel={t(`kind.${e.kind}`)}>
                  {e.status === "active" ? t("end") : t("reopen")}
                </ActionButton>
                <ActionButton action={removeEngagementAction.bind(null, assetId, e.id)} srLabel={t(`kind.${e.kind}`)}>
                  {t("remove")}
                </ActionButton>
              </div>
              <p className="text-muted-foreground">
                {[
                  e.startsOn ? t("startsOn", { date: formatDate(e.startsOn) }) : null,
                  e.endsOn ? t("endsOn", { date: formatDate(e.endsOn) }) : null,
                  e.askingCents !== null ? t("asking", { amount: formatEuro(e.askingCents) }) : null,
                  e.commission ? t("commission", { commission: e.commission }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {e.documentId && e.documentTitle ? (
                <Link href={`/documenti/${e.documentId}`} className="w-fit underline underline-offset-2">
                  {e.documentTitle}
                </Link>
              ) : null}
              {e.note ? <p className="whitespace-pre-wrap">{e.note}</p> : null}
              <EditInline
                idPrefix={`listing-edit-${e.id}`}
                title={`${te("editing")}: ${t(`kind.${e.kind}`)} ${e.agentName ?? ""}`.trim()}
                openLabel={te("edit")}
                cancelLabel={te("cancel")}
                srLabel={t(`kind.${e.kind}`)}
                submitLabel={te("save")}
                fields={engagementFields(documentsWith(e))}
                initial={{
                  kind: e.kind,
                  agentPartyId: e.agentPartyId ?? "",
                  startsOn: e.startsOn ?? "",
                  endsOn: e.endsOn ?? "",
                  exclusive: e.exclusive,
                  asking: e.askingCents !== null ? formatCents(e.askingCents) : "",
                  commission: e.commission ?? "",
                  documentId: e.documentId ?? "",
                  note: e.note ?? "",
                }}
                onSubmit={updateEngagementAction.bind(null, assetId, e.id)}
              />
              <p className="font-medium" data-testid="listing-counts">
                {t("counts", { visits: e.counts.visits, proposals: e.counts.proposals })}
              </p>
              <ul className="flex flex-col gap-2" data-testid="listing-events">
                {e.events.map((ev) => (
                  <li key={ev.id} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{t(`eventKind.${ev.kind}`)}</Badge>
                      <span>{formatDate(ev.occurredOn)}</span>
                      {ev.amountCents !== null ? <span>{t("eventAmount", { amount: formatEuro(ev.amountCents) })}</span> : null}
                      {ev.outcome ? <span>{t(`outcome.${ev.outcome}`)}</span> : null}
                      {ev.contactName ? <span>{t("eventContact", { name: ev.contactName })}</span> : null}
                      {ev.note ? <span className="text-muted-foreground">{ev.note}</span> : null}
                      <ActionButton action={removeListingEventAction.bind(null, assetId, ev.id)} srLabel={`${t(`eventKind.${ev.kind}`)} ${formatDate(ev.occurredOn)}`}>
                        {t("eventRemove")}
                      </ActionButton>
                    </div>
                    <EditInline
                      idPrefix={`listing-event-edit-${ev.id}`}
                      title={`${te("editing")}: ${t(`eventKind.${ev.kind}`)} ${formatDate(ev.occurredOn)}`}
                      openLabel={te("edit")}
                      cancelLabel={te("cancel")}
                      srLabel={`${t(`eventKind.${ev.kind}`)} ${formatDate(ev.occurredOn)}`}
                      submitLabel={te("save")}
                      fields={eventFields()}
                      initial={{
                        kind: ev.kind,
                        occurredOn: ev.occurredOn,
                        amount: ev.amountCents !== null ? formatCents(ev.amountCents) : "",
                        outcome: ev.outcome ?? "",
                        contactPartyId: ev.contactPartyId ?? "",
                        note: ev.note ?? "",
                      }}
                      onSubmit={updateListingEventAction.bind(null, assetId, ev.id)}
                    />
                  </li>
                ))}
              </ul>
              <InlineForm
                idPrefix={`listing-event-${e.id}`}
                title={`${t("eventAdd")}: ${t(`kind.${e.kind}`)} ${e.agentName ?? ""}`.trim()}
                fields={eventFields()}
                initial={{ kind: "", occurredOn: "", amount: "", outcome: "", contactPartyId: "", note: "" }}
                submitLabel={t("eventAddButton")}
                onSubmit={addListingEventAction.bind(null, assetId, e.id)}
              />
            </li>
          ))}
        </ul>
        <InlineForm
          idPrefix="listing"
          title={t("add")}
          fields={engagementFields(documents)}
          initial={{ kind: "", agentPartyId: "", startsOn: "", endsOn: "", exclusive: false, asking: "", commission: "", documentId: "", note: "" }}
          submitLabel={t("addButton")}
          onSubmit={addEngagementAction.bind(null, assetId)}
        />
      </CardContent>
    </Card>
  );
}
