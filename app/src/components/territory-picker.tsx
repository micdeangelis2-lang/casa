"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

export type TerritoryChoice = { id: string; label: string };

type Props = {
  id: string;
  /** Tipi di territorio ammessi nella ricerca, separati da virgola nella richiesta. */
  kinds: string[];
  value: TerritoryChoice | null;
  onChange: (value: TerritoryChoice | null) => void;
  invalid?: boolean;
  describedBy?: string;
};

/**
 * Campo di ricerca con elenco di risultati (modello ARIA "combobox" con elenco): digitando almeno 2 lettere
 * interroga /api/territori; frecce su/giu' per spostarsi, Invio per scegliere, Esc per chiudere.
 */
export function TerritoryPicker({ id, kinds, value, onChange, invalid, describedBy }: Props) {
  const t = useTranslations("territories");
  const listId = useId();
  // Il testo parte dalla scelta iniziale; per ripartire da zero il genitore rimonta il campo con una `key` diversa.
  const [text, setText] = useState(value?.label ?? "");
  const [results, setResults] = useState<TerritoryChoice[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const requestRef = useRef(0);

  async function search(query: string) {
    const ticket = ++requestRef.current;
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/territori?q=${encodeURIComponent(query)}&kinds=${kinds.join(",")}`);
      const data = (await response.json()) as { results?: TerritoryChoice[] };
      // Risposte arrivate fuori ordine non devono sovrascrivere quelle piu' recenti.
      if (ticket === requestRef.current) setResults(data.results ?? []);
    } catch {
      if (ticket === requestRef.current) setResults([]);
    } finally {
      if (ticket === requestRef.current) setLoading(false);
    }
  }

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function onInput(next: string) {
    setText(next);
    if (value) onChange(null); // si e' ricominciato a scrivere: la scelta precedente non vale piu'
    setOpen(true);
    setActive(-1);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(next), 250);
  }

  function choose(item: TerritoryChoice) {
    onChange(item);
    setText(item.label);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && open && active >= 0 && results[active]) {
      event.preventDefault();
      choose(results[active]!);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && text.trim().length >= 2;

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        placeholder={t("searchPlaceholder")}
        value={text}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onFocus={() => text.trim().length >= 2 && !value && setOpen(true)}
      />
      <ul
        id={listId}
        role="listbox"
        hidden={!showList}
        className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md"
      >
        {loading ? (
          <li role="presentation" className="px-2 py-1.5 text-muted-foreground">
            {t("searching")}
          </li>
        ) : results.length === 0 ? (
          <li role="presentation" className="px-2 py-1.5 text-muted-foreground">
            {t("noMatches")}
          </li>
        ) : (
          results.map((item, index) => (
            <li
              key={item.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={`cursor-pointer rounded-md px-2 py-1.5 ${index === active ? "bg-accent text-accent-foreground" : ""}`}
              // onMouseDown (non onClick): il campo perderebbe il focus prima del click e l'elenco si chiuderebbe.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
            >
              {item.label}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
