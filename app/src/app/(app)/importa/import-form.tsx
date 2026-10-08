"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Copy, MinusCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/form-field";
import { ScrollRegion } from "@/components/scroll-region";
import { useFocusOn } from "@/components/use-focus-on";
import { importAction, type ImportActionResult } from "./actions";

const KINDS = ["contacts", "assets", "deadlines", "rents", "taxes", "taxPayments", "policies"] as const;
type Kind = (typeof KINDS)[number];
const TEMPLATE_TYPE: Record<Kind, string> = {
  contacts: "contatti",
  assets: "immobili",
  deadlines: "scadenze",
  rents: "canoni",
  taxes: "tributi",
  taxPayments: "pagamenti-tributi",
  policies: "polizze",
};
const LIST_HREF: Record<Kind, string> = {
  contacts: "/rubrica",
  assets: "/immobili",
  deadlines: "/scadenze",
  rents: "/locazioni",
  taxes: "/tributi",
  taxPayments: "/tributi",
  policies: "/assicurazioni",
};
const STATUS_ICON = { ready: CheckCircle2, duplicate: Copy, error: AlertTriangle, skipped: MinusCircle } as const;

export function ImportForm() {
  const t = useTranslations("import");
  const [kind, setKind] = useState<Kind>("contacts");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  // Il risultato prende il focus: chi usa la tastiera o un lettore di schermo lo trova subito.
  useFocusOn(resultRef, result);

  async function send(mode: "preview" | "import") {
    if (!file) {
      setResult({ phase: "error", message: t("errors.noFile") });
      return;
    }
    setPending(true);
    setResult(null);
    try {
      const data = new FormData();
      data.set("kind", kind);
      data.set("mode", mode);
      data.set("file", file);
      setResult(await importAction(data));
    } catch {
      setResult({ phase: "error", message: t("errors.generic") });
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send("preview");
  }

  const preview = result?.phase === "preview" ? result.preview : null;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4" aria-busy={pending}>
        <Field id="import-kind" label={t("kindLabel")} hint={t(`kindHint.${kind}`)}>
          {(props) => (
            <NativeSelect
              {...props}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind);
                setResult(null);
              }}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <p className="text-sm">
          <a className="underline underline-offset-4" href={`/api/importa/modello?tipo=${TEMPLATE_TYPE[kind]}`} download>
            {t("template")}
          </a>
        </p>
        <Field id="import-file" label={t("fileLabel")} hint={t("fileHint")}>
          {(props) => (
            <Input
              {...props}
              type="file"
              accept=".csv,.txt,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResult(null);
              }}
            />
          )}
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("working") : t("check")}
          </Button>
        </div>
      </form>

      <div ref={resultRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
        {result?.phase === "error" && (
          <p role="alert" className="rounded-xl border border-destructive/50 p-4 text-sm">
            {result.message}
          </p>
        )}

        {preview && (
          <>
            <section className="flex flex-col gap-2 rounded-xl border p-4" aria-labelledby="import-summary">
              <h2 id="import-summary" className="text-lg font-medium">
                {t("summary.title")}
              </h2>
              <p className="text-sm">{t("summary.line", preview.counts)}</p>
              {preview.counts.skipped > 0 && <p className="text-sm">{t("summary.skipped", { n: preview.counts.skipped })}</p>}
              <p className="text-sm text-muted-foreground">{t("summary.noWrite")}</p>
              {preview.ignoredHeaders.length > 0 && (
                <p className="text-sm text-muted-foreground">{t("summary.ignored", { list: preview.ignoredHeaders.join(", ") })}</p>
              )}
            </section>

            <ScrollRegion label={t("table.label")}>
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">{t("table.caption")}</caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="p-2">{t("table.line")}</th>
                    <th scope="col" className="p-2">{t("table.name")}</th>
                    <th scope="col" className="p-2">{t("table.outcome")}</th>
                    <th scope="col" className="p-2">{t("table.detail")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const Icon = STATUS_ICON[row.status];
                    return (
                      <tr key={row.line} className="border-b align-top">
                        <td className="p-2 tabular-nums">{row.line}</td>
                        <td className="p-2">{row.label || t("table.noName")}</td>
                        <td className="p-2">
                          <span className="inline-flex items-center gap-1 font-medium">
                            <Icon aria-hidden className="size-4" />
                            {t(`status.${row.status}`)}
                          </span>
                        </td>
                        <td className="p-2">
                          {row.column ? `${t("table.column", { column: row.column })}: ` : ""}
                          {row.message ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollRegion>

            {preview.counts.ready > 0 ? (
              <div>
                <Button type="button" disabled={pending} onClick={() => void send("import")}>
                  {pending ? t("working") : t("importButton", { n: preview.counts.ready })}
                </Button>
              </div>
            ) : (
              <p className="text-sm">{t("nothingToImport")}</p>
            )}
          </>
        )}

        {result?.phase === "done" && (
          <section className="flex flex-col gap-2 rounded-xl border p-4" aria-labelledby="import-done">
            <h2 id="import-done" className="text-lg font-medium">
              {t("done.title")}
            </h2>
            <p className="text-sm">{t("done.line", { imported: result.counts.ready, duplicate: result.counts.duplicate, error: result.counts.error })}</p>
            {result.counts.skipped > 0 && <p className="text-sm">{t("summary.skipped", { n: result.counts.skipped })}</p>}
            <div>
              <Link href={LIST_HREF[result.kind]} className={buttonVariants()}>
                {t(`done.open.${result.kind}`)}
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
