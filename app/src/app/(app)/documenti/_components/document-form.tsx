"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form-field";
import { CONFIDENTIALITY, MAX_FILE_BYTES, VERIFICATION_STATUS } from "@/modules/documents/client";
import type { FieldErrors } from "@/shared/result";
import type { SaveResult } from "../actions";
import { formValuesToFormData, type DocumentFormValues } from "../document-form-state";
import { useFocusOn } from "@/components/use-focus-on";

export type Option = { id: string; label: string };

type Props = {
  /** create: file + dati; edit: solo dati; version: file + dati della versione. */
  mode: "create" | "edit" | "version";
  initial: DocumentFormValues;
  categories: Option[];
  assets: Option[];
  parties: Option[];
  onSubmit: (data: FormData) => Promise<SaveResult>;
  cancelHref: string;
  /** Titolo della pagina (nel modo "version" non si ripete il titolo del documento). */
  heading?: string;
};

export function DocumentForm({ mode, initial, categories, assets, parties, onSubmit, cancelHref, heading }: Props) {
  const t = useTranslations("documents.form");
  const tc = useTranslations("common");
  const ts = useTranslations("documents");
  const [values, setValues] = useState<DocumentFormValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  useFocusOn(summaryRef, Object.keys(errors).length > 0 ? errors : null);

  const err = (path: string) => errors[path]?.[0];
  const set = <K extends keyof DocumentFormValues>(key: K, value: DocumentFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const needsFile = mode !== "edit";
  const hasDocumentFields = mode !== "version";

  function fail(next: FieldErrors) {
    setErrors(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0] ?? null;
    if (needsFile && !file) return fail({ file: [t("fileMissing")] });
    if (file && file.size > MAX_FILE_BYTES) return fail({ file: [t("fileTooBig")] });
    setErrors({});
    startTransition(async () => {
      try {
        const result = await onSubmit(formValuesToFormData(values, needsFile ? file : null));
        // Con successo la azione reindirizza e non torna qui; se torna, ci sono errori da mostrare.
        if (result?.errors) fail(result.errors);
      } catch {
        fail({ _: [tc("generalError")] });
      }
    });
  }

  const errorList = Object.entries(errors).flatMap(([path, messages]) => messages.map((m) => ({ path, message: m })));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{heading ?? (mode === "create" ? t("titleNew") : t("titleEdit"))}</h1>
        {mode === "create" ? <p className="text-sm text-muted-foreground">{t("intro")}</p> : null}
      </header>

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

      {needsFile ? (
        <Field id="file" label={t("file")} hint={t("fileHint")} error={err("file")}>
          {(p) => <Input {...p} ref={fileRef} type="file" />}
        </Field>
      ) : null}

      {hasDocumentFields ? (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-lg font-medium">{ts("detail.details")}</legend>
          <Field id="title" label={t("title")} hint={mode === "create" ? t("titleHint") : undefined} error={err("title")}>
            {(p) => <Input {...p} value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={200} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="categoryId" label={t("category")} error={err("categoryId")}>
              {(p) => (
                <NativeSelect {...p} value={values.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                  <option value="">{tc("notIndicated")}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field id="confidentiality" label={t("confidentiality")} hint={t("confidentialityHint")} error={err("confidentiality")}>
              {(p) => (
                <NativeSelect {...p} value={values.confidentiality} onChange={(e) => set("confidentiality", e.target.value as DocumentFormValues["confidentiality"])}>
                  {CONFIDENTIALITY.map((c) => (
                    <option key={c} value={c}>
                      {ts(`confidentiality.${c}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>

          <div role="group" aria-labelledby="assets-legend" className="flex flex-col gap-2">
            <span id="assets-legend" className="text-sm font-medium">
              {t("assets")}
            </span>
            <p className="text-sm text-muted-foreground">{t("assetsHint")}</p>
            {assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noAssets")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {assets.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`asset-${a.id}`}
                      checked={values.assetIds.includes(a.id)}
                      onCheckedChange={(checked) =>
                        set("assetIds", checked === true ? [...values.assetIds, a.id] : values.assetIds.filter((id) => id !== a.id))
                      }
                    />
                    <Label htmlFor={`asset-${a.id}`}>{a.label}</Label>
                  </li>
                ))}
              </ul>
            )}
            {err("assetIds") ? <p className="text-sm text-destructive">{err("assetIds")}</p> : null}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-medium">{mode === "version" ? t("versionData") : t("fileData")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="issuerPartyId" label={t("issuer")} hint={t("issuerHint")} error={err("issuerPartyId")}>
            {(p) => (
              <NativeSelect {...p} value={values.issuerPartyId} onChange={(e) => set("issuerPartyId", e.target.value)}>
                <option value="">{tc("notIndicated")}</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="verificationStatus" label={t("status")} error={err("verificationStatus")}>
            {(p) => (
              <NativeSelect {...p} value={values.verificationStatus} onChange={(e) => set("verificationStatus", e.target.value as DocumentFormValues["verificationStatus"])}>
                {VERIFICATION_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {ts(`status.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="issuedOn" label={t("issuedOn")} error={err("issuedOn")}>
            {(p) => <Input {...p} type="date" value={values.issuedOn} onChange={(e) => set("issuedOn", e.target.value)} />}
          </Field>
          <Field id="validFrom" label={t("validFrom")} error={err("validFrom")}>
            {(p) => <Input {...p} type="date" value={values.validFrom} onChange={(e) => set("validFrom", e.target.value)} />}
          </Field>
          <Field id="validTo" label={t("validTo")} error={err("validTo")}>
            {(p) => <Input {...p} type="date" value={values.validTo} onChange={(e) => set("validTo", e.target.value)} />}
          </Field>
        </div>
        <Field id="note" label={t("versionNote")} error={err("note")}>
          {(p) => <Input {...p} value={values.note} onChange={(e) => set("note", e.target.value)} maxLength={500} />}
        </Field>
      </fieldset>

      {hasDocumentFields ? (
        <Field id="notes" label={t("notes")} error={err("notes")}>
          {(p) => <Textarea {...p} rows={4} value={values.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />}
        </Field>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : mode === "create" ? t("submitNew") : mode === "version" ? ts("detail.addVersionSubmit") : t("submitEdit")}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "ghost" })}>
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
