"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DOSSIER_STATUSES } from "@/modules/dossier/client";
import type { FieldErrors } from "@/shared/result";
import { addItemAction, deleteItemAction, evaluateAction, linkDocumentAction, saveNoteAction, setStatusAction, unlinkDocumentAction } from "../actions";

export function EvaluateButton({ assetId }: { assetId: string }) {
  const t = useTranslations("dossier");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 print:hidden">
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await evaluateAction(assetId);
              if (!result.ok) return setMessage(result.message);
              const d = result.diff;
              setMessage(d.created + d.updated + d.staled + d.restored === 0 ? t("evaluatedNone") : t("evaluated", { created: d.created, updated: d.updated, staled: d.staled, restored: d.restored }));
            })
          }
        >
          <RefreshCw aria-hidden /> {t("evaluate")}
        </Button>
      </div>
      <div aria-live="polite">
        {message ? (
          <Alert>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}

export function StatusSelect({ assetId, itemId, status, title }: { assetId: string; itemId: string; status: string; title: string }) {
  const t = useTranslations("dossier");
  const [value, setValue] = useState(status);
  const [pending, startTransition] = useTransition();
  const id = `status-${itemId}`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>
        {t("item.status")}
        <span className="sr-only">: {title}</span>
      </Label>
      <NativeSelect
        id={id}
        value={value}
        disabled={pending}
        onChange={(e) => {
          setValue(e.target.value);
          startTransition(() => setStatusAction(assetId, itemId, e.target.value));
        }}
      >
        {DOSSIER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export function NoteForm({ assetId, itemId, note, title }: { assetId: string; itemId: string; note: string; title: string }) {
  const t = useTranslations("dossier.item");
  const [value, setValue] = useState(note);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const id = `note-${itemId}`;
  return (
    <div className="flex flex-col gap-2 print:hidden">
      <Label htmlFor={id}>
        {t("note")}
        <span className="sr-only">: {title}</span>
      </Label>
      <Textarea id={id} rows={2} value={value} maxLength={1000} onChange={(e) => setValue(e.target.value)} />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending || value === note}
          onClick={() =>
            startTransition(async () => {
              const result = await saveNoteAction(assetId, itemId, value);
              setSaved(result.error ?? t("noteSaved"));
            })
          }
        >
          {t("saveNote")}
          <span className="sr-only">: {title}</span>
        </Button>
        <span aria-live="polite" className="text-sm text-muted-foreground">
          {saved}
        </span>
      </div>
    </div>
  );
}

export function LinkDocument({ assetId, itemId, options, title }: { assetId: string; itemId: string; options: { id: string; label: string }[]; title: string }) {
  const t = useTranslations("dossier.item");
  const [documentId, setDocumentId] = useState("");
  const [pending, startTransition] = useTransition();
  const id = `link-${itemId}`;
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>
          {t("link")}
          <span className="sr-only">: {title}</span>
        </Label>
        <NativeSelect id={id} value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
          <option value="">{t("linkChoose")}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending || documentId === ""}
        onClick={() =>
          startTransition(async () => {
            await linkDocumentAction(assetId, itemId, documentId);
            setDocumentId("");
          })
        }
      >
        {t("linkButton")}
        <span className="sr-only">: {title}</span>
      </Button>
    </div>
  );
}

export function UnlinkButton({ assetId, itemId, documentId, documentTitle }: { assetId: string; itemId: string; documentId: string; documentTitle: string }) {
  const t = useTranslations("dossier.item");
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="ghost" size="sm" className="print:hidden" disabled={pending} onClick={() => startTransition(() => unlinkDocumentAction(assetId, itemId, documentId))}>
      {t("unlink")}
      <span className="sr-only">: {documentTitle}</span>
    </Button>
  );
}

export function DeleteItemButton({ assetId, itemId, title }: { assetId: string; itemId: string; title: string }) {
  const t = useTranslations("dossier.item");
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="ghost" size="sm" className="print:hidden" disabled={pending} onClick={() => startTransition(() => deleteItemAction(assetId, itemId))}>
      <Trash2 aria-hidden /> {t("delete")}
      <span className="sr-only">: {title}</span>
    </Button>
  );
}

export function AddItemForm({ assetId, categories }: { assetId: string; categories: { id: string; name: string }[] }) {
  const t = useTranslations("dossier.add");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const err = (k: string) => errors[k]?.[0];
  return (
    <form
      noValidate
      className="flex flex-col gap-4 rounded-lg border p-4 print:hidden"
      aria-label={t("heading")}
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await addItemAction(assetId, { categoryId, title, ownerNote: note });
          if (result.errors) return setErrors(result.errors);
          setErrors({});
          setTitle("");
          setNote("");
        });
      }}
    >
      <h2 className="text-lg font-medium">{t("heading")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="add-category">{t("category")}</Label>
          <NativeSelect id="add-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-invalid={Boolean(err("categoryId"))}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          {err("categoryId") ? <p className="text-sm text-destructive">{err("categoryId")}</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="add-title">{t("titleLabel")}</Label>
          <Input id="add-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-invalid={Boolean(err("title"))} aria-describedby={err("title") ? "add-title-error" : undefined} />
          {err("title") ? (
            <p id="add-title-error" className="text-sm text-destructive">
              {err("title")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="add-note">{t("note")}</Label>
        <Input id="add-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          <Plus aria-hidden /> {t("button")}
        </Button>
      </div>
    </form>
  );
}
