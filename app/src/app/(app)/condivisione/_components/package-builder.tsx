"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form-field";
import type { FieldErrors } from "@/shared/result";
import { createPackageAction } from "../actions";

export type CandidateView = { id: string; title: string; categoryName: string; confidentiality: string; exceedsCap: boolean; assetNames: string[]; sizeBytes: number };

/** La scheda proposta (dalla pagina di partenza): tipo e scelte, gia' validate sul server al momento della creazione. */
export type SheetOffer = { kind: string; spec: Record<string, unknown> };

type Props = { candidates: CandidateView[]; cap: string; recipientTypes: string[]; initialRecipientType?: string; initialRecipientName?: string; sheetOffer?: SheetOffer };

/** Seconda fase del pacchetto: destinatario e scelta dei documenti. Quelli oltre il livello scelto partono esclusi, con un avviso. */
export function PackageBuilder({ candidates, cap, recipientTypes, initialRecipientType, initialRecipientName = "", sheetOffer }: Props) {
  const t = useTranslations("sharing");
  const tb = useTranslations("sharing.builder");
  const tc = useTranslations("common");
  const [recipientType, setRecipientType] = useState(initialRecipientType ?? recipientTypes[0] ?? "other");
  const [recipientName, setRecipientName] = useState(initialRecipientName);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(candidates.filter((c) => !c.exceedsCap).map((c) => c.id)));
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [includeSheet, setIncludeSheet] = useState(true);
  const [includeProofs, setIncludeProofs] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const summaryRef = useRef<HTMLDivElement>(null);

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  // Un documento oltre il livello entra solo se e' scelto E la scelta «includi comunque» e' esplicita.
  const chosen = candidates.filter((c) => selected.has(c.id) && (!c.exceedsCap || overrides.has(c.id)));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await createPackageAction({
        recipientType,
        recipientName,
        confidentialityCap: cap,
        note,
        documents: chosen.map((c) => ({ documentId: c.id, overrideAboveCap: c.exceedsCap })),
        ...(sheetOffer && includeSheet ? { sheet: { ...sheetOffer.spec, kind: sheetOffer.kind, ...(sheetOffer.kind === "accountant" ? { includeProofs } : {}) } } : {}),
      });
      if (result?.errors) {
        setErrors(result.errors);
        requestAnimationFrame(() => summaryRef.current?.focus());
      }
    });
  }

  const err = (k: string) => errors[k]?.[0];
  const errorList = Object.entries(errors).flatMap(([path, messages]) => messages.map((m) => ({ path, message: m })));
  const megabytes = (n: number) => (n / (1024 * 1024)).toLocaleString("it-IT", { maximumFractionDigits: 1 });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">{tb("step2")}</h2>
      {errorList.length > 0 ? (
        <div ref={summaryRef} tabIndex={-1} className="outline-none">
          <Alert variant="destructive">
            <AlertTitle>{tc("errorSummary")}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {errorList.map((e, i) => (
                  <li key={`${e.path}-${i}`}>{e.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="recipientType" label={tb("recipientType")} error={err("recipientType")}>
          {(p) => (
            <NativeSelect {...p} value={recipientType} onChange={(e) => setRecipientType(e.target.value)}>
              {recipientTypes.map((r) => (
                <option key={r} value={r}>
                  {t(`recipient.${r as "other"}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id="recipientName" label={tb("recipientName")} error={err("recipientName")}>
          {(p) => <Input {...p} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} maxLength={160} />}
        </Field>
      </div>
      <Field id="note" label={tb("note")} error={err("note")}>
        {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
      </Field>

      {sheetOffer ? (
        <fieldset className="flex flex-col gap-2" data-testid="package-sheet">
          <legend className="mb-1 text-sm font-medium">{tb("sheet.legend")}</legend>
          <div className="flex items-center gap-2">
            <Checkbox id="include-sheet" checked={includeSheet} onCheckedChange={(v) => setIncludeSheet(v === true)} />
            <Label htmlFor="include-sheet">{tb("sheet.include", { title: tb(`sheet.titleFor.${sheetOffer.kind as "notary"}`) })}</Label>
          </div>
          <p className="text-sm text-muted-foreground">{tb("sheet.hint")}</p>
          {sheetOffer.kind === "accountant" && includeSheet ? (
            <div className="flex items-center gap-2">
              <Checkbox id="include-proofs" checked={includeProofs} onCheckedChange={(v) => setIncludeProofs(v === true)} />
              <Label htmlFor="include-proofs">{tb("sheet.proofs")}</Label>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{tb("documents")}</legend>
        {candidates.length === 0 ? <p className="text-sm text-muted-foreground">{tb("noDocuments")}</p> : null}
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="package-candidates">
          {candidates.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 p-3">
              <div className="flex items-start gap-2">
                <Checkbox id={`doc-${c.id}`} checked={selected.has(c.id)} onCheckedChange={(v) => setSelected((s) => toggle(s, c.id, v === true))} />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`doc-${c.id}`} className="font-medium">
                    {c.title}
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    {[c.categoryName, c.assetNames.join(", "), tb("size", { size: megabytes(c.sizeBytes) })].filter(Boolean).join(" · ")}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Badge variant="outline">{t(`confidentiality.${c.confidentiality as "ordinary"}`)}</Badge>
                    {c.exceedsCap ? (
                      <Badge variant="destructive">
                        <TriangleAlert aria-hidden /> {tb("warning", { level: t(`confidentiality.${cap as "ordinary"}`) })}
                      </Badge>
                    ) : null}
                  </span>
                </div>
              </div>
              {c.exceedsCap && selected.has(c.id) ? (
                <div className="ml-7 flex flex-col gap-1 rounded-md border border-destructive/40 p-2">
                  <p className="text-sm">{tb("overrideHint")}</p>
                  <div className="flex items-center gap-2">
                    <Checkbox id={`override-${c.id}`} checked={overrides.has(c.id)} onCheckedChange={(v) => setOverrides((s) => toggle(s, c.id, v === true))} />
                    <Label htmlFor={`override-${c.id}`}>
                      {tb("override")}
                      <span className="sr-only">: {c.title}</span>
                    </Label>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {err("documents") ? <p className="text-sm text-destructive">{err("documents")}</p> : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {tb("submit")}
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {tb("selected", { count: chosen.length })}
        </span>
      </div>
    </form>
  );
}
