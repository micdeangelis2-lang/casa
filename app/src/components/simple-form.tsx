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
import type { FieldErrors } from "@/shared/result";

export type Option = { value: string; label: string };

/** Il campo compare solo se il valore di un altro campo e' tra quelli indicati. */
export type ShowIf = { name: string; in: string[] };
type Common = { name: string; label: string; hint?: string; /** Una o piu' condizioni: devono valere tutte. */ showIf?: ShowIf | ShowIf[] };
export type FieldSpec =
  | (Common & { kind: "text"; maxLength?: number; inputMode?: "numeric" | "decimal" | "email" | "tel" | "url" })
  | (Common & { kind: "textarea"; rows?: number; maxLength?: number })
  | (Common & { kind: "date" })
  | (Common & { kind: "select"; options: Option[]; emptyLabel?: string })
  | (Common & { kind: "checkbox" })
  | (Common & { kind: "multicheck"; options: Option[]; emptyText?: string });

export type FormValue = string | boolean | string[];
export type FormValues = Record<string, FormValue>;
export type SimpleSaveResult = { errors: FieldErrors } | undefined;

export type FormSection = { legend?: string; intro?: string; fields: FieldSpec[]; columns?: 1 | 2 | 3 };

type Props = {
  title: string;
  intro?: string;
  sections: FormSection[];
  initial: FormValues;
  submitLabel: string;
  /** Con successo la azione reindirizza e non torna; se torna, ci sono errori da mostrare. */
  onSubmit: (values: FormValues) => Promise<SimpleSaveResult>;
  cancelHref: string;
};


export type FieldContext = {
  values: FormValues;
  errors: FieldErrors;
  set: (name: string, value: FormValue) => void;
  /** Prefisso degli id: serve quando nella stessa pagina ci sono piu' moduli. */
  idPrefix?: string;
};

export function renderFormField(spec: FieldSpec, ctx: FieldContext) {
  const { values, errors, set, idPrefix = "f" } = ctx;
  const text = (name: string) => (typeof values[name] === "string" ? (values[name] as string) : "");
  const error = errors[spec.name]?.[0];
  const id = `${idPrefix}-${spec.name}`;
  if (spec.kind === "checkbox") {
    return (
      <div key={spec.name} className="flex items-center gap-2">
        <Checkbox id={id} checked={values[spec.name] === true} onCheckedChange={(v) => set(spec.name, v === true)} />
        <Label htmlFor={id}>{spec.label}</Label>
      </div>
    );
  }
  if (spec.kind === "multicheck") {
    const selected = Array.isArray(values[spec.name]) ? (values[spec.name] as string[]) : [];
    return (
      <div key={spec.name} role="group" aria-labelledby={`${id}-legend`} className="flex flex-col gap-2">
        <span id={`${id}-legend`} className="text-sm font-medium">
          {spec.label}
        </span>
        {spec.hint ? <p className="text-sm text-muted-foreground">{spec.hint}</p> : null}
        {spec.options.length === 0 ? <p className="text-sm text-muted-foreground">{spec.emptyText}</p> : null}
        <ul className="flex flex-col gap-2">
          {spec.options.map((o) => (
            <li key={o.value} className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${o.value}`}
                checked={selected.includes(o.value)}
                onCheckedChange={(v) => set(spec.name, v === true ? [...selected, o.value] : selected.filter((x) => x !== o.value))}
              />
              <Label htmlFor={`${id}-${o.value}`}>{o.label}</Label>
            </li>
          ))}
        </ul>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }
  return (
    <Field key={spec.name} id={id} label={spec.label} hint={spec.hint} error={error}>
      {(p) => {
        if (spec.kind === "textarea") return <Textarea {...p} rows={spec.rows ?? 3} maxLength={spec.maxLength} value={text(spec.name)} onChange={(e) => set(spec.name, e.target.value)} />;
        if (spec.kind === "date") return <Input {...p} type="date" value={text(spec.name)} onChange={(e) => set(spec.name, e.target.value)} />;
        if (spec.kind === "select") {
          return (
            <NativeSelect {...p} value={text(spec.name)} onChange={(e) => set(spec.name, e.target.value)}>
              {spec.emptyLabel !== undefined ? <option value="">{spec.emptyLabel}</option> : null}
              {spec.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          );
        }
        return <Input {...p} inputMode={spec.inputMode} maxLength={spec.maxLength} value={text(spec.name)} onChange={(e) => set(spec.name, e.target.value)} />;
      }}
    </Field>
  );
}

const GRID: Record<number, string> = { 1: "flex flex-col gap-4", 2: "grid gap-4 sm:grid-cols-2", 3: "grid gap-4 sm:grid-cols-3" };

/**
 * Modulo generico a campi dichiarati: etichette, suggerimenti ed errori collegati (aria-describedby), riepilogo degli errori
 * che riceve il focus, nessun campo senza etichetta. La validazione vera la fa sempre il server.
 */
export function SimpleForm({ title, intro, sections, initial, submitLabel, onSubmit, cancelHref }: Props) {
  const tc = useTranslations("common");
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const summaryRef = useRef<HTMLDivElement>(null);

  const set = (name: string, value: FormValue) => setValues((v) => ({ ...v, [name]: value }));
  const text = (name: string) => (typeof values[name] === "string" ? (values[name] as string) : "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      try {
        const result = await onSubmit(values);
        if (result?.errors) {
          setErrors(result.errors);
          requestAnimationFrame(() => summaryRef.current?.focus());
        }
      } catch {
        setErrors({ _: [tc("generalError")] });
        requestAnimationFrame(() => summaryRef.current?.focus());
      }
    });
  }

  const errorList = Object.entries(errors).flatMap(([path, messages]) => messages.map((m) => ({ path, message: m })));

  const visible = (spec: FieldSpec) => !spec.showIf || ([] as ShowIf[]).concat(spec.showIf).every((c) => c.in.includes(text(c.name)));

  const renderField = (spec: FieldSpec) => renderFormField(spec, { values, errors, set });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {intro ? <p className="text-sm text-muted-foreground">{intro}</p> : null}
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

      {sections.map((section, i) => (
        <fieldset key={i} className="flex flex-col gap-4">
          {section.legend ? <legend className="mb-2 text-lg font-medium">{section.legend}</legend> : null}
          {section.intro ? <p className="text-sm text-muted-foreground">{section.intro}</p> : null}
          <div className={(section.columns ?? 1) === 1 ? "flex flex-col gap-4" : GRID[section.columns ?? 1]}>{section.fields.filter(visible).map(renderField)}</div>
        </fieldset>
      ))}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? tc("saving") : submitLabel}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "ghost" })}>
          {tc("cancel")}
        </Link>
      </div>
    </form>
  );
}
