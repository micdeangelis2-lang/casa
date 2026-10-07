"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { InlineForm } from "@/components/inline-form";
import type { Option } from "@/components/simple-form";
import { addEventAction, addOpinionAction, addRequestAction, assignAction, linkDocumentAction, removeEventAction, resolveRequestAction, unassignAction, unlinkDocumentAction } from "../actions";

type Props = { matterId: string; parties: Option[]; documents: Option[] };

export function AssignForm({ matterId, parties }: Pick<Props, "matterId" | "parties">) {
  const t = useTranslations("matters.detail");
  return (
    <InlineForm
      idPrefix="assign"
      title={t("assignButton")}
      fields={[
        { kind: "select", name: "partyId", label: t("assignParty"), options: parties, emptyLabel: t("assignChoose") },
        { kind: "text", name: "role", label: t("assignRole"), maxLength: 80 },
      ]}
      initial={{ partyId: "", role: "" }}
      submitLabel={t("assignButton")}
      onSubmit={(v) => assignAction(matterId, v)}
    />
  );
}

export function UnassignButton({ matterId, partyId, name }: { matterId: string; partyId: string; name: string }) {
  const t = useTranslations("matters.detail");
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="ghost" size="sm" className="print:hidden" disabled={pending} onClick={() => startTransition(() => unassignAction(matterId, partyId))}>
      {t("unassign")}
      <span className="sr-only">: {name}</span>
    </Button>
  );
}

export function RequestForm({ matterId, parties }: Pick<Props, "matterId" | "parties">) {
  const t = useTranslations("matters.detail");
  return (
    <InlineForm
      idPrefix="request"
      title={t("requestAdd")}
      fields={[
        { kind: "text", name: "title", label: t("requestTitle"), maxLength: 200 },
        { kind: "select", name: "requestedFromPartyId", label: t("requestFrom"), options: parties, emptyLabel: "—" },
        { kind: "date", name: "dueOn", label: t("requestDue") },
        { kind: "text", name: "note", label: t("requestNote"), maxLength: 500 },
      ]}
      initial={{ title: "", requestedFromPartyId: "", dueOn: "", note: "" }}
      submitLabel={t("requestAdd")}
      onSubmit={(v) => addRequestAction(matterId, v)}
    />
  );
}

/** Esito di una richiesta: ricevuta (con il documento), non disponibile, oppure di nuovo richiesta. */
export function ResolveRequest({ matterId, requestId, status, documents, title }: { matterId: string; requestId: string; status: string; documents: Option[]; title: string }) {
  const t = useTranslations("matters.detail");
  const [value, setValue] = useState(status);
  const [documentId, setDocumentId] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const id = `resolve-${requestId}`;
  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>
          {t("resolve")}
          <span className="sr-only">: {title}</span>
        </Label>
        <NativeSelect id={id} value={value} onChange={(e) => setValue(e.target.value)}>
          {(["requested", "received", "not_available"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`requestStatus.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {value === "received" ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-doc`}>{t("resolveDocument")}</Label>
          <NativeSelect id={`${id}-doc`} value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
            <option value="">{t("resolveNone")}</option>
            {documents.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending || (value === status && documentId === "")}
        onClick={() =>
          startTransition(async () => {
            const result = await resolveRequestAction(matterId, requestId, { status: value, documentId });
            setError(result.errors ? Object.values(result.errors).flat()[0] : undefined);
          })
        }
      >
        {t("resolveButton")}
        <span className="sr-only">: {title}</span>
      </Button>
      {error ? <span className="text-sm text-destructive">{error}</span> : null}
    </div>
  );
}

export function OpinionForm({ matterId, parties, documents }: Props) {
  const t = useTranslations("matters.detail");
  return (
    <InlineForm
      idPrefix="opinion"
      title={t("opinionAdd")}
      fields={[
        { kind: "select", name: "partyId", label: t("opinionParty"), options: parties, emptyLabel: t("assignChoose") },
        {
          kind: "select",
          name: "nature",
          label: t("opinionNature"),
          options: [
            { value: "informational", label: t("nature.informational") },
            { value: "formally_validated", label: t("nature.formally_validated") },
          ],
          emptyLabel: "—",
        },
        { kind: "textarea", name: "summary", label: t("opinionSummary"), maxLength: 1500 },
        { kind: "date", name: "issuedOn", label: t("opinionDate") },
        { kind: "select", name: "documentId", label: t("opinionDocument"), options: documents, emptyLabel: t("resolveNone") },
      ]}
      initial={{ partyId: "", nature: "", summary: "", issuedOn: "", documentId: "" }}
      submitLabel={t("opinionAdd")}
      onSubmit={(v) => addOpinionAction(matterId, v)}
    />
  );
}

const EVENT_KINDS = ["note", "hearing", "term", "communication", "meeting"] as const;

export function EventForm({ matterId, parties, documents }: Props) {
  const t = useTranslations("matters.detail");
  return (
    <InlineForm
      idPrefix="event"
      title={t("eventAdd")}
      fields={[
        { kind: "select", name: "kind", label: t("eventKind"), options: EVENT_KINDS.map((k) => ({ value: k, label: t(`eventKinds.${k}`) })), emptyLabel: t("eventKindChoose") },
        { kind: "date", name: "occurredOn", label: t("eventDate") },
        { kind: "text", name: "title", label: t("eventTitle"), maxLength: 200 },
        { kind: "textarea", name: "note", label: t("eventNote"), maxLength: 1500 },
        { kind: "select", name: "partyId", label: t("eventParty"), options: parties, emptyLabel: "—" },
        { kind: "select", name: "documentId", label: t("eventDocument"), options: documents, emptyLabel: t("resolveNone") },
      ]}
      initial={{ kind: "", occurredOn: "", title: "", note: "", partyId: "", documentId: "" }}
      submitLabel={t("eventAdd")}
      onSubmit={(v) => addEventAction(matterId, v)}
    />
  );
}

export function RemoveEventButton({ matterId, eventId, title }: { matterId: string; eventId: string; title: string }) {
  const t = useTranslations("matters.detail");
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="ghost" size="sm" className="print:hidden" disabled={pending} onClick={() => startTransition(() => removeEventAction(matterId, eventId))}>
      {t("eventRemove")}
      <span className="sr-only">: {title}</span>
    </Button>
  );
}

export function LinkDocumentForm({ matterId, documents }: Pick<Props, "matterId" | "documents">) {
  const t = useTranslations("matters.detail");
  const [documentId, setDocumentId] = useState("");
  const [pending, startTransition] = useTransition();
  if (documents.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <div className="flex flex-col gap-1">
        <Label htmlFor="matter-link">{t("linkDocument")}</Label>
        <NativeSelect id="matter-link" value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
          <option value="">{t("linkChoose")}</option>
          {documents.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending || documentId === ""}
        onClick={() =>
          startTransition(async () => {
            await linkDocumentAction(matterId, documentId);
            setDocumentId("");
          })
        }
      >
        {t("linkButton")}
      </Button>
    </div>
  );
}

export function UnlinkDocumentButton({ matterId, documentId, title }: { matterId: string; documentId: string; title: string }) {
  const t = useTranslations("matters.detail");
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="ghost" size="sm" className="print:hidden" disabled={pending} onClick={() => startTransition(() => unlinkDocumentAction(matterId, documentId))}>
      {t("unlink")}
      <span className="sr-only">: {title}</span>
    </Button>
  );
}
