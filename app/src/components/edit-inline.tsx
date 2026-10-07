"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineForm } from "@/components/inline-form";

type FormProps = Parameters<typeof InlineForm>[0];

type Props = FormProps & {
  /** Testo del pulsante che apre la modifica. */
  openLabel: string;
  cancelLabel: string;
  /** A cosa si riferisce il pulsante, per i lettori di schermo. */
  srLabel?: string;
};

/**
 * Modifica sul posto di una voce di un elenco: un pulsante apre il modulo gia' compilato con i valori attuali; con successo il
 * modulo si chiude, con errori resta aperto con i messaggi accanto ai campi. Il focus passa al primo campo all'apertura e torna
 * al pulsante alla chiusura.
 */
export function EditInline({ openLabel, cancelLabel, srLabel, onSubmit, ...form }: Props) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    else if (wasOpen.current) opener.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!open) {
    return (
      <Button ref={opener} type="button" variant="ghost" size="sm" className="w-fit print:hidden" aria-expanded={false} onClick={() => setOpen(true)}>
        {openLabel}
        {srLabel ? <span className="sr-only">: {srLabel}</span> : null}
      </Button>
    );
  }

  return (
    <div ref={box} className="flex flex-col gap-2">
      <InlineForm
        {...form}
        onSubmit={async (values) => {
          const result = await onSubmit(values);
          if (!result.errors) setOpen(false);
          return result;
        }}
      />
      <Button type="button" variant="ghost" size="sm" className="w-fit print:hidden" onClick={() => setOpen(false)}>
        {cancelLabel}
        {srLabel ? <span className="sr-only">: {srLabel}</span> : null}
      </Button>
    </div>
  );
}
