"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { COMPLETION_KINDS, type CompletionKind } from "@/modules/deadlines/client";
import type { FieldErrors } from "@/shared/result";
import { addOccurrenceAction, addProofAction, archiveDeadlineAction, completeOccurrenceAction, occurrenceAction, snoozeAction } from "../actions";

type Option = { id: string; label: string };

export function ArchiveDeadlineButton({ deadlineId, archived }: { deadlineId: string; archived: boolean }) {
  const t = useTranslations("deadlines.detail");
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="ghost" disabled={pending} onClick={() => startTransition(() => archiveDeadlineAction(deadlineId, !archived))}>
      {archived ? t("restore") : t("archive")}
    </Button>
  );
}

const firstError = (errors: FieldErrors | undefined) => (errors ? Object.values(errors).flat()[0] : undefined);

/** Aggiunge una data a mano. */
export function AddOccurrence({ deadlineId }: { deadlineId: string }) {
  const t = useTranslations("deadlines.detail");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-occurrence">{t("addOccurrence")}</Label>
          <Input id="new-occurrence" type="date" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "new-occurrence-error" : undefined} />
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || value === ""}
          onClick={() =>
            startTransition(async () => {
              const result = await addOccurrenceAction(deadlineId, value);
              setError(firstError(result.errors));
              if (!result.errors) setValue("");
            })
          }
        >
          {t("addOccurrenceButton")}
        </Button>
      </div>
      {error ? (
        <p id="new-occurrence-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type OccurrenceProps = {
  deadlineId: string;
  occurrenceId: string;
  status: string;
  dueOn: string;
  documents: Option[];
  kindLabels: Record<CompletionKind, string>;
  proofRequired: boolean;
};

/** Azioni su una data: completare (con prova e chi la attesta), riaprire, rinviare, annullare, aggiungere prove. */
export function OccurrenceControls({ deadlineId, occurrenceId, status, dueOn, documents, kindLabels, proofRequired }: OccurrenceProps) {
  const t = useTranslations("deadlines");
  const tc = useTranslations("deadlines.complete");
  const td = useTranslations("deadlines.detail");
  const [kind, setKind] = useState<CompletionKind>("owner");
  const [completedOn, setCompletedOn] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [snoozeUntil, setSnoozeUntil] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const id = `occ-${occurrenceId}`;
  const err = (k: string) => errors[k]?.[0];

  if (status === "done" || status === "cancelled") {
    return (
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => startTransition(() => occurrenceAction(deadlineId, occurrenceId, "reopen"))}>
          {td("reopen")}
          <span className="sr-only"> {dueOn}</span>
        </Button>
        {status === "done" ? <ProofForm deadlineId={deadlineId} occurrenceId={occurrenceId} documents={documents} dueOn={dueOn} /> : null}
      </div>
    );
  }

  return (
    <details className="rounded-md border p-3 print:hidden">
      <summary className="cursor-pointer text-sm font-medium">
        {td("complete")}
        <span className="sr-only"> {dueOn}</span>
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        {proofRequired ? <p className="text-sm text-muted-foreground">{tc("proofNeeded")}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-on`}>{tc("completedOn")}</Label>
            <Input id={`${id}-on`} type="date" value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-kind`}>{tc("kind")}</Label>
            <NativeSelect id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as CompletionKind)} aria-invalid={Boolean(err("completionKind"))}>
              {COMPLETION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabels[k]}
                </option>
              ))}
            </NativeSelect>
            {err("completionKind") ? <p className="text-sm text-destructive">{err("completionKind")}</p> : null}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-doc`}>{tc("document")}</Label>
            <NativeSelect id={`${id}-doc`} value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">{tc("noDocument")}</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </NativeSelect>
            {err("documentId") ? <p className="text-sm text-destructive">{err("documentId")}</p> : null}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-ref`}>{tc("reference")}</Label>
            <Input id={`${id}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={300} aria-invalid={Boolean(err("reference"))} />
            {err("reference") ? <p className="text-sm text-destructive">{err("reference")}</p> : null}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-note`}>{tc("note")}</Label>
          <Textarea id={`${id}-note`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </div>
        <div>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await completeOccurrenceAction(deadlineId, occurrenceId, { completedOn, completionKind: kind, documentId, reference, note });
                setErrors(result.errors ?? {});
              })
            }
          >
            {tc("button")}
            <span className="sr-only"> {dueOn}</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-snooze`}>{td("snooze")}</Label>
            <Input id={`${id}-snooze`} type="date" value={snoozeUntil} onChange={(e) => setSnoozeUntil(e.target.value)} aria-invalid={Boolean(err("snoozeUntil"))} />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || snoozeUntil === ""}
            onClick={() =>
              startTransition(async () => {
                const result = await snoozeAction(deadlineId, occurrenceId, snoozeUntil);
                setErrors(result.errors ?? {});
              })
            }
          >
            {td("snoozeButton")}
            <span className="sr-only"> {dueOn}</span>
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => startTransition(() => occurrenceAction(deadlineId, occurrenceId, "cancel"))}>
            {td("cancel")}
            <span className="sr-only"> {dueOn}</span>
          </Button>
        </div>
        {err("snoozeUntil") ? <p className="text-sm text-destructive">{err("snoozeUntil")}</p> : null}
        <p className="sr-only">{t("title")}</p>
      </div>
    </details>
  );
}

function ProofForm({ deadlineId, occurrenceId, documents, dueOn }: { deadlineId: string; occurrenceId: string; documents: Option[]; dueOn: string }) {
  const td = useTranslations("deadlines.detail");
  const tc = useTranslations("deadlines.complete");
  const [documentId, setDocumentId] = useState("");
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const id = `proof-${occurrenceId}`;
  return (
    <details className="rounded-md border p-2 text-sm">
      <summary className="cursor-pointer">
        {td("addProof")}
        <span className="sr-only"> {dueOn}</span>
      </summary>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-doc`}>{tc("document")}</Label>
          <NativeSelect id={`${id}-doc`} value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
            <option value="">{tc("noDocument")}</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-ref`}>{tc("reference")}</Label>
          <Input id={`${id}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={300} />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await addProofAction(deadlineId, occurrenceId, { documentId: documentId || undefined, reference: reference || undefined });
              setMessage(firstError(result.errors));
              if (!result.errors) {
                setDocumentId("");
                setReference("");
              }
            })
          }
        >
          {td("addProof")}
          <span className="sr-only"> {dueOn}</span>
        </Button>
      </div>
      {message ? (
        <Alert className="mt-2">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </details>
  );
}
