"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { renderFormField, type FieldSpec, type FormValue, type FormValues, type ShowIf } from "@/components/simple-form";
import type { FieldErrors } from "@/shared/result";

type Props = {
  title: string;
  fields: FieldSpec[];
  initial: FormValues;
  submitLabel: string;
  /** Restituisce gli errori da mostrare, o niente se e' andata bene (il modulo si svuota). */
  onSubmit: (values: FormValues) => Promise<{ errors?: FieldErrors }>;
  /** Prefisso degli id dei campi (unico nella pagina). */
  idPrefix: string;
};

/**
 * Piccolo modulo dentro una pagina (aggiungere una voce a un elenco): niente reindirizzamento, errori accanto ai campi,
 * si svuota quando l'operazione riesce.
 */
export function InlineForm({ title, fields, initial, submitLabel, onSubmit, idPrefix }: Props) {
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const set = (name: string, value: FormValue) => setValues((v) => ({ ...v, [name]: value }));
  const text = (name: string) => (typeof values[name] === "string" ? (values[name] as string) : "");
  const visible = (spec: FieldSpec) => !spec.showIf || ([] as ShowIf[]).concat(spec.showIf).every((c) => c.in.includes(text(c.name)));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await onSubmit(values);
      setErrors(result.errors ?? {});
      if (!result.errors) setValues(initial);
    });
  }

  // Un errore che non corrisponde a un campo visibile (generale, o su un campo che il modulo non mostra) non deve sparire:
  // si mostra qui sopra, cosi' un'operazione rifiutata non resta mai senza spiegazione.
  const shown = new Set(fields.filter(visible).map((f) => f.name));
  const general = Object.entries(errors).flatMap(([name, messages]) => (shown.has(name) ? [] : messages));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-lg border p-4 print:hidden" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      {general.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            {general.length === 1 ? (
              general[0]
            ) : (
              <ul className="list-disc pl-5">
                {general.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">{fields.filter(visible).map((f) => renderFormField(f, { values, errors, set, idPrefix }))}</div>
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
