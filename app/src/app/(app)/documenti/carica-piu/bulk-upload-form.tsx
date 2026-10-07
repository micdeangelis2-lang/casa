"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Clock, Copy, Loader2, XCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/form-field";
import { CONFIDENTIALITY, MAX_FILE_BYTES, type Confidentiality } from "@/modules/documents/client";
import { uploadOneDocumentAction, type UploadOutcome } from "./actions";
import { MAX_TITLE_LENGTH, titleFromFilename } from "./title-from-filename";

/** Quanti file al massimo in un lotto. */
export const MAX_BATCH_FILES = 20;

type Option = { id: string; label: string };
type Status = "pending" | "uploading" | "created" | "duplicate" | "rejected" | "error";

type Item = {
  key: number;
  file: File;
  title: string;
  status: Status;
  message?: string;
  documentId?: string;
  documentTitle?: string;
  matches?: { id: string; title: string }[];
  /** Rifiutato prima dell'invio (vuoto o troppo grande): riprovare non serve. */
  permanent?: boolean;
};

const MB = MAX_FILE_BYTES / (1024 * 1024);
const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toLocaleString("it-IT", { maximumFractionDigits: 1 });

const STATUS_ICON = {
  pending: Clock,
  uploading: Loader2,
  created: CheckCircle2,
  duplicate: Copy,
  rejected: XCircle,
  error: AlertTriangle,
} as const;

export function BulkUploadForm({ categories, assets, defaultCategoryId }: { categories: Option[]; assets: Option[]; defaultCategoryId: string }) {
  const t = useTranslations("bulkUpload");
  const td = useTranslations("documents");
  const [items, setItems] = useState<Item[]>([]);
  const [categoryId, setCategoryId] = useState(defaultCategoryId);
  const [assetId, setAssetId] = useState("");
  const [confidentiality, setConfidentiality] = useState<Confidentiality>("ordinary");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [finished, setFinished] = useState(0);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const itemsRef = useRef<Item[]>([]);
  const nextKey = useRef(1);
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // A fine lotto il focus passa al riepilogo: chi usa la tastiera o un lettore di schermo ne sente l'esito.
  useEffect(() => {
    if (finished > 0) summaryRef.current?.focus();
  }, [finished]);

  const patch = (key: number, changes: Partial<Item>) => setItems((all) => all.map((i) => (i.key === key ? { ...i, ...changes } : i)));

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const room = Math.max(0, MAX_BATCH_FILES - itemsRef.current.length);
    const accepted = incoming.slice(0, room);
    setNotice(incoming.length > accepted.length ? t("tooMany", { max: MAX_BATCH_FILES, skipped: incoming.length - accepted.length }) : "");
    const added: Item[] = accepted.map((file) => {
      const base: Item = { key: nextKey.current++, file, title: titleFromFilename(file.name), status: "pending" };
      if (file.size === 0) return { ...base, status: "rejected", message: t("emptyFile"), permanent: true };
      if (file.size > MAX_FILE_BYTES) return { ...base, status: "rejected", message: t("tooBig", { mb: MB }), permanent: true };
      return base;
    });
    setItems((all) => [...all, ...added]);
    setFinished(0);
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!running) addFiles(event.dataTransfer.files);
  }

  async function sendOne(item: Item, force: boolean): Promise<UploadOutcome> {
    const data = new FormData();
    data.set("file", item.file);
    data.set("title", item.title);
    data.set("categoryId", categoryId);
    data.set("confidentiality", confidentiality);
    data.set("assetId", assetId);
    if (force) data.set("force", "1");
    try {
      return await uploadOneDocumentAction(data);
    } catch {
      return { status: "error" };
    }
  }

  async function run(keys: number[], force = false) {
    if (running || keys.length === 0) return;
    setRunning(true);
    setFinished(0);
    for (const [index, key] of keys.entries()) {
      const item = itemsRef.current.find((i) => i.key === key);
      if (!item) continue;
      setProgress({ current: index + 1, total: keys.length });
      patch(key, { status: "uploading", message: undefined, matches: undefined });
      const outcome = await sendOne(item, force);
      if (outcome.status === "created") patch(key, { status: "created", documentId: outcome.id, documentTitle: outcome.title });
      else if (outcome.status === "duplicate") patch(key, { status: "duplicate", matches: outcome.matches });
      else if (outcome.status === "rejected") patch(key, { status: "rejected", message: outcome.message });
      else patch(key, { status: "error", message: t("unexpected") });
    }
    setRunning(false);
    setFinished((n) => n + 1);
  }

  const pending = items.filter((i) => i.status === "pending");
  const failed = items.filter((i) => i.status === "error" || (i.status === "rejected" && !i.permanent));
  const count = (status: Status) => items.filter((i) => i.status === status).length;
  const full = items.length >= MAX_BATCH_FILES;
  const editable = (i: Item) => i.status === "pending" || i.status === "error" || (i.status === "rejected" && !i.permanent);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro", { max: MAX_BATCH_FILES })}</p>
      </header>

      <fieldset className="flex flex-col gap-4" disabled={running}>
        <legend className="mb-2 text-lg font-medium">{t("settings")}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="bulk-category" label={t("category")}>
            {(p) => (
              <NativeSelect {...p} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="bulk-asset" label={t("asset")}>
            {(p) => (
              <NativeSelect {...p} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">{t("assetNone")}</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="bulk-confidentiality" label={t("confidentiality")}>
            {(p) => (
              <NativeSelect {...p} value={confidentiality} onChange={(e) => setConfidentiality(e.target.value as Confidentiality)}>
                {CONFIDENTIALITY.map((c) => (
                  <option key={c} value={c}>
                    {td(`confidentiality.${c}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
      </fieldset>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!running) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col gap-2 rounded-lg border border-dashed p-4 ${dragging ? "border-ring bg-accent/50" : ""}`}
        data-testid="drop-zone"
      >
        <Field id="bulk-files" label={t("filesLabel")} hint={t("filesHint", { max: MAX_BATCH_FILES, mb: MB })}>
          {(p) => <Input {...p} type="file" multiple onChange={onPick} disabled={running || full} />}
        </Field>
        {notice ? <p className="text-sm font-medium">{notice}</p> : null}
      </div>

      <section aria-labelledby="bulk-list-title" className="flex flex-col gap-4">
        <h2 id="bulk-list-title" className="text-lg font-medium">
          {t("listTitle", { count: items.length })}
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border" data-testid="bulk-items">
            {items.map((item) => {
              const Icon = STATUS_ICON[item.status];
              return (
                <li key={item.key} className="flex flex-col gap-2 p-4" data-status={item.status}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">
                      {item.file.name} · {t("size", { size: megabytes(item.file.size) })}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm font-medium" data-testid="item-status">
                      <Icon className={`size-4 ${item.status === "uploading" ? "animate-spin" : ""}`} aria-hidden />
                      {t(`status.${item.status}`)}
                    </span>
                  </div>
                  {editable(item) ? (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`bulk-title-${item.key}`}>{t("fileTitle", { name: item.file.name })}</Label>
                      <div className="flex gap-2">
                        <Input
                          id={`bulk-title-${item.key}`}
                          value={item.title}
                          maxLength={MAX_TITLE_LENGTH}
                          disabled={running}
                          onChange={(e) => patch(item.key, { title: e.target.value })}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={running}
                          aria-label={t("remove", { name: item.file.name })}
                          onClick={() => setItems((all) => all.filter((i) => i.key !== item.key))}
                        >
                          {t("removeShort")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="font-medium">{item.documentTitle ?? item.title}</p>
                  )}
                  {item.message ? <p className="text-sm">{item.message}</p> : null}
                  {item.status === "created" && item.documentId ? (
                    <Link href={`/documenti/${item.documentId}`} className="w-fit text-sm underline underline-offset-4">
                      {t("openCard", { title: item.documentTitle ?? item.title })}
                    </Link>
                  ) : null}
                  {item.status === "duplicate" ? (
                    <div className="flex flex-col items-start gap-2 text-sm">
                      <p>{t("duplicateOf", { title: item.matches?.map((m) => m.title).join(", ") ?? "" })}</p>
                      <ul className="flex flex-col gap-1">
                        {item.matches?.map((m) => (
                          <li key={m.id}>
                            <Link href={`/documenti/${m.id}`} className="underline underline-offset-4">
                              {t("duplicateLink", { title: m.title })}
                            </Link>
                          </li>
                        ))}
                      </ul>
                      <Button type="button" variant="outline" size="sm" disabled={running} onClick={() => run([item.key], true)}>
                        {t("uploadAnyway", { name: item.file.name })}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={running || pending.length === 0} onClick={() => run(pending.map((i) => i.key))}>
          {t("start", { count: pending.length })}
        </Button>
        {failed.length > 0 ? (
          <Button type="button" variant="secondary" disabled={running} onClick={() => run(failed.map((i) => i.key))}>
            {t("retry", { count: failed.length })}
          </Button>
        ) : null}
        {items.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            disabled={running}
            onClick={() => {
              setItems([]);
              setFinished(0);
              setNotice("");
            }}
          >
            {t("clear")}
          </Button>
        ) : null}
        <Link href="/documenti" className={buttonVariants({ variant: "ghost" })}>
          {t("back")}
        </Link>
      </div>

      <div aria-live="polite" className="text-sm" data-testid="bulk-progress">
        {running ? t("progress", { current: progress.current, total: progress.total }) : ""}
      </div>

      {finished > 0 && !running ? (
        <div
          ref={summaryRef}
          role="status"
          tabIndex={-1}
          className="flex flex-col gap-1 rounded-lg border p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="bulk-summary"
        >
          <h2 className="font-medium">{t("summaryTitle")}</h2>
          <p>{t("summaryDone")}</p>
          <p>{t("summary", { created: count("created"), duplicate: count("duplicate"), rejected: count("rejected"), error: count("error") })}</p>
          <Link href="/documenti" className="w-fit underline underline-offset-4">
            {t("openList")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
