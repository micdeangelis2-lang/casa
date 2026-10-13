"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

type Props = {
  id: string;
  /** Testo libero del campo. */
  value: string;
  onChange: (value: string) => void;
  /** Id del territorio Comune scelto; senza, il campo e' un normale campo di testo. */
  comuneId: string | null;
  maxLength?: number;
  invalid?: boolean;
  describedBy?: string;
};

type Status = "idle" | "loading" | "empty" | "unavailable";

const DEBOUNCE_MS = 400;
/** Policy di OpenStreetMap: al massimo una richiesta al secondo (il server la fa rispettare con 429). */
const MIN_INTERVAL_MS = 1000;

/**
 * Campo di testo libero con suggerimenti (modello ARIA "combobox" con elenco, come TerritoryPicker): dopo 2 lettere,
 * con il Comune scelto, interroga /api/localita (il server chiama OpenStreetMap). Frecce, Invio ed Esc come nel selettore del Comune.
 * I suggerimenti sono solo un aiuto: si puo' sempre scrivere altro.
 */
export function PlaceSuggestInput({ id, value, onChange, comuneId, maxLength, invalid, describedBy }: Props) {
  const t = useTranslations("assets.form");
  const listId = useId();
  // Il risultato porta con se' il Comune per cui e' stato ottenuto: cambiando Comune non vale piu' e si ignora.
  const [result, setResult] = useState<{ comune: string | null; items: string[]; status: Status }>({ comune: null, items: [], status: "idle" });
  const items = result.comune === comuneId ? result.items : [];
  const status: Status = result.comune === comuneId ? result.status : "idle";
  const setItems = (list: string[]) => setResult((r) => ({ comune: comuneId, items: list, status: r.status }));
  const setStatus = (next: Status) => setResult((r) => ({ comune: comuneId, items: r.comune === comuneId ? r.items : [], status: next }));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const lastRequestAt = useRef(0);
  const cache = useRef(new Map<string, string[]>());

  function cancel() {
    clearTimeout(timer.current);
    controller.current?.abort();
    controller.current = null;
  }

  // Cambiando Comune (o togliendolo) la ricerca in corso non serve piu'; allo smontaggio si annulla tutto.
  useEffect(() => cancel, [comuneId]);

  async function search(comune: string, text: string) {
    const key = `${comune}|${text.toLowerCase()}`;
    const cached = cache.current.get(key);
    if (cached) {
      setItems(cached);
      setStatus(cached.length === 0 ? "empty" : "idle");
      return;
    }
    const ctl = new AbortController();
    controller.current = ctl;
    lastRequestAt.current = Date.now();
    setStatus("loading");
    try {
      const response = await fetch(`/api/localita?comune=${encodeURIComponent(comune)}&q=${encodeURIComponent(text)}`, { signal: ctl.signal });
      if (!response.ok) throw new Error("service");
      const data = (await response.json()) as { suggestions?: string[] };
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      cache.current.set(key, suggestions);
      setItems(suggestions);
      setStatus(suggestions.length === 0 ? "empty" : "idle");
    } catch {
      if (ctl.signal.aborted) return;
      setItems([]);
      setStatus("unavailable");
    }
  }

  function onInput(next: string) {
    onChange(next);
    if (!comuneId) return;
    setActive(-1);
    cancel();
    if (next.trim().length < 2) {
      setItems([]);
      setStatus("idle");
      setOpen(false);
      return;
    }
    setOpen(true);
    setStatus("loading");
    const wait = Math.max(DEBOUNCE_MS, MIN_INTERVAL_MS - (Date.now() - lastRequestAt.current));
    timer.current = setTimeout(() => void search(comuneId, next.trim()), wait);
  }

  function choose(name: string) {
    cancel();
    onChange(name);
    setItems([]);
    setStatus("idle");
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!comuneId) return;
    if (event.key === "ArrowDown" && items.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === "ArrowUp" && items.length > 0) {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && open && active >= 0 && items[active]) {
      event.preventDefault(); // niente invio del modulo: si sceglie il suggerimento
      choose(items[active]!);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  const showList = open && items.length > 0;
  const message =
    !open || !comuneId
      ? null
      : status === "loading"
        ? t("localitySearching")
        : status === "unavailable"
          ? t("localityUnavailable")
          : status === "empty"
            ? t("localityNoMatches")
            : null;

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        value={value}
        maxLength={maxLength}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onFocus={() => items.length > 0 && setOpen(true)}
      />
      <ul id={listId} role="listbox" aria-label={t("localitySuggestions")} hidden={!showList} className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
        {items.map((name, index) => (
          <li
            key={name}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            className={`cursor-pointer rounded-md px-2 py-1.5 ${index === active ? "bg-accent text-accent-foreground" : ""}`}
            // onMouseDown (non onClick): il campo perderebbe il focus prima del click e l'elenco si chiuderebbe.
            onMouseDown={(e) => {
              e.preventDefault();
              choose(name);
            }}
          >
            {name}
          </li>
        ))}
      </ul>
      <p role="status" className="mt-1 min-h-0 text-sm text-muted-foreground empty:hidden">
        {message}
      </p>
    </div>
  );
}
