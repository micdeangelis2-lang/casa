"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form-field";
import { TerritoryPicker } from "@/components/territory-picker";
import { ASSET_KINDS, ATTRIBUTE_TYPES, LINK_VALIDATION, RIGHT_TYPES, USE_TYPES } from "@/modules/assets/client";
import type { FieldErrors } from "@/shared/result";
import type { SaveResult } from "../actions";
import { useFocusOn } from "@/components/use-focus-on";
import {
  formStateToPayload,
  newAttributeRow,
  newCadastralRow,
  newLinkRow,
  newRightRow,
  type AssetFormState,
  type AttributeRow,
  type CadastralRow,
  type LinkRow,
  type RightRow,
} from "../asset-form-state";

export type PartyOption = { id: string; label: string };
export type AssetOption = { id: string; label: string };

type Props = {
  mode: "create" | "edit";
  initial: AssetFormState;
  /** Contatti della rubrica scelti come titolari (escluso il proprietario). */
  parties: PartyOption[];
  /** Id del contatto "proprietario", se gia' esiste; altrimenti si usa il valore speciale "self". */
  ownerPartyId: string | null;
  /** Altri beni a cui questo puo' essere collegato (senza se stesso). */
  otherAssets: AssetOption[];
  onSubmit: (payload: unknown) => Promise<SaveResult>;
  cancelHref: string;
};

export function AssetForm({ mode, initial, parties, ownerPartyId, otherAssets, onSubmit, cancelHref }: Props) {
  const t = useTranslations("assets");
  const tc = useTranslations("common");
  const [state, setState] = useState<AssetFormState>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const summaryRef = useRef<HTMLDivElement>(null);
  useFocusOn(summaryRef, Object.keys(errors).length > 0 ? errors : null);

  const err = (path: string) => errors[path]?.[0];
  const set = <K extends keyof AssetFormState>(key: K, value: AssetFormState[K]) => setState((s) => ({ ...s, [key]: value }));
  const selfValue = ownerPartyId ?? "self";

  const updateRow = <T extends { key: string }>(list: "rights" | "cadastral" | "links" | "attributes", key: string, patch: Partial<T>) =>
    setState((s) => ({
      ...s,
      [list]: (s[list] as unknown as T[]).map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));
  const removeRow = (list: "rights" | "cadastral" | "links" | "attributes", key: string) =>
    setState((s) => ({ ...s, [list]: (s[list] as { key: string }[]).filter((row) => row.key !== key) }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await onSubmit(formStateToPayload(state));
      // Con successo la azione reindirizza e non torna qui; se torna, ci sono errori da mostrare.
      if (result?.errors) {
        setErrors(result.errors);
      }
    });
  }

  const errorList = Object.entries(errors).flatMap(([path, messages]) => messages.map((m) => ({ path, message: m })));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{mode === "create" ? t("form.titleNew") : t("form.titleEdit")}</h1>
        {mode === "create" ? <p className="text-sm text-muted-foreground">{t("form.intro")}</p> : null}
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

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-medium">{t("form.basics")}</legend>
        <Field id="kind" label={t("form.kind")} error={err("kind")}>
          {(p) => (
            <NativeSelect {...p} value={state.kind} onChange={(e) => set("kind", e.target.value)}>
              {ASSET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id="name" label={t("form.name")} hint={t("form.nameHint")} error={err("name")}>
          {(p) => <Input {...p} value={state.name} onChange={(e) => set("name", e.target.value)} maxLength={160} />}
        </Field>
        <Field id="useType" label={t("form.useType")} error={err("useType")}>
          {(p) => (
            <NativeSelect {...p} value={state.useType} onChange={(e) => set("useType", e.target.value)}>
              <option value="">{tc("notIndicated")}</option>
              {USE_TYPES.map((u) => (
                <option key={u} value={u}>
                  {t(`use.${u}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <div className="flex items-center gap-2">
          <Checkbox id="inCondominium" checked={state.inCondominium} onCheckedChange={(v) => set("inCondominium", v === true)} />
          <Label htmlFor="inCondominium">{t("form.inCondominium")}</Label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-medium">{t("form.location")}</legend>
        <Field id="territory" label={t("form.territory")} hint={t("form.territoryHint")} error={err("territoryId")}>
          {(p) => (
            <TerritoryPicker
              id={p.id}
              kinds={["municipality"]}
              value={state.territory}
              onChange={(v) => set("territory", v)}
              invalid={p["aria-invalid"]}
              describedBy={p["aria-describedby"]}
            />
          )}
        </Field>
        <Field id="locality" label={t("form.locality")} error={err("locality")}>
          {(p) => <Input {...p} value={state.locality} onChange={(e) => set("locality", e.target.value)} maxLength={120} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field id="address" label={t("form.address")} error={err("address")}>
            {(p) => <Input {...p} value={state.address} onChange={(e) => set("address", e.target.value)} maxLength={200} />}
          </Field>
          <Field id="postalCode" label={t("form.postalCode")} error={err("postalCode")}>
            {(p) => <Input {...p} inputMode="numeric" value={state.postalCode} onChange={(e) => set("postalCode", e.target.value)} maxLength={5} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-medium">{t("form.ownership")}</legend>
        <p className="text-sm text-muted-foreground">{t("form.ownershipIntro")}</p>
        {state.rights.map((row, i) => (
          <RightFields
            key={row.key}
            row={row}
            index={i}
            selfValue={selfValue}
            ownerPartyId={ownerPartyId}
            parties={parties}
            err={err}
            onChange={(patch) => updateRow<RightRow>("rights", row.key, patch)}
            onRemove={() => removeRow("rights", row.key)}
          />
        ))}
        <Button type="button" variant="outline" className="self-start" onClick={() => setState((s) => ({ ...s, rights: [...s.rights, newRightRow(s.rights.length === 0 ? selfValue : "")] }))}>
          <Plus aria-hidden /> {t("form.addRight")}
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-medium">{t("form.cadastral")}</legend>
        <p className="text-sm text-muted-foreground">{t("form.cadastralIntro")}</p>
        {state.cadastral.map((row, i) => (
          <CadastralFields
            key={row.key}
            row={row}
            index={i}
            err={err}
            onChange={(patch) => updateRow<CadastralRow>("cadastral", row.key, patch)}
            onRemove={() => removeRow("cadastral", row.key)}
          />
        ))}
        <Button type="button" variant="outline" className="self-start" onClick={() => setState((s) => ({ ...s, cadastral: [...s.cadastral, newCadastralRow()] }))}>
          <Plus aria-hidden /> {t("form.addCadastral")}
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-medium">{t("form.links")}</legend>
        <p className="text-sm text-muted-foreground">{t("form.linksIntro")}</p>
        {state.links.map((row, i) => (
          <LinkFields
            key={row.key}
            row={row}
            index={i}
            otherAssets={otherAssets}
            err={err}
            onChange={(patch) => updateRow<LinkRow>("links", row.key, patch)}
            onRemove={() => removeRow("links", row.key)}
          />
        ))}
        {otherAssets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("form.noOtherAssets")}</p>
        ) : (
          <Button type="button" variant="outline" className="self-start" onClick={() => setState((s) => ({ ...s, links: [...s.links, newLinkRow()] }))}>
            <Plus aria-hidden /> {t("form.addLink")}
          </Button>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-medium">{t("form.attributes")}</legend>
        <p className="text-sm text-muted-foreground">{t("form.attributesIntro")}</p>
        {state.attributes.map((row, i) => (
          <AttributeFields
            key={row.key}
            row={row}
            index={i}
            err={err}
            onChange={(patch) => updateRow<AttributeRow>("attributes", row.key, patch)}
            onRemove={() => removeRow("attributes", row.key)}
          />
        ))}
        <Button type="button" variant="outline" className="self-start" onClick={() => setState((s) => ({ ...s, attributes: [...s.attributes, newAttributeRow()] }))}>
          <Plus aria-hidden /> {t("form.addAttribute")}
        </Button>
      </fieldset>

      <Field id="notes" label={t("form.notes")} error={err("notes")}>
        {(p) => <Textarea {...p} rows={4} value={state.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />}
      </Field>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("form.saving") : mode === "create" ? t("form.submitNew") : t("form.submitEdit")}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "ghost" })}>
          {t("form.cancel")}
        </Link>
      </div>
    </form>
  );
}

type ErrFn = (path: string) => string | undefined;

function RowShell({ title, onRemove, children }: { title: string; onRemove: () => void; children: React.ReactNode }) {
  const tc = useTranslations("common");
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 aria-hidden /> {tc("remove")}
          <span className="sr-only"> {title}</span>
        </Button>
      </div>
      {children}
    </div>
  );
}

function RightFields({
  row,
  index,
  selfValue,
  ownerPartyId,
  parties,
  err,
  onChange,
  onRemove,
}: {
  row: RightRow;
  index: number;
  selfValue: string;
  ownerPartyId: string | null;
  parties: PartyOption[];
  err: ErrFn;
  onChange: (patch: Partial<RightRow>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("assets.form");
  const tr = useTranslations("assets");
  const id = `right-${row.key}`;
  const p = `rights.${index}`;
  return (
    <RowShell title={`${t("right")} ${index + 1}`} onRemove={onRemove}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-holder`} label={t("holder")} error={err(`${p}.holder`)}>
          {(c) => (
            <NativeSelect {...c} value={row.holder} onChange={(e) => onChange({ holder: e.target.value })}>
              <option value="">{tr("form.linkChoose")}</option>
              <option value={selfValue}>{t("holderSelf")}</option>
              {parties
                .filter((party) => party.id !== ownerPartyId)
                .map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.label}
                  </option>
                ))}
            </NativeSelect>
          )}
        </Field>
        <Field id={`${id}-type`} label={t("rightType")} error={err(`${p}.rightType`)}>
          {(c) => (
            <NativeSelect {...c} value={row.rightType} onChange={(e) => onChange({ rightType: e.target.value })}>
              {RIGHT_TYPES.map((r) => (
                <option key={r} value={r}>
                  {tr(`right.${r}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-num`} label={t("quotaNumerator")} hint={t("quotaHint")} error={err(`${p}.quotaNumerator`)}>
          {(c) => <Input {...c} inputMode="numeric" value={row.quotaNumerator} onChange={(e) => onChange({ quotaNumerator: e.target.value })} />}
        </Field>
        <Field id={`${id}-den`} label={t("quotaDenominator")} error={err(`${p}.quotaDenominator`)}>
          {(c) => <Input {...c} inputMode="numeric" value={row.quotaDenominator} onChange={(e) => onChange({ quotaDenominator: e.target.value })} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-from`} label={t("validFrom")} error={err(`${p}.validFrom`)}>
          {(c) => <Input {...c} type="date" value={row.validFrom} onChange={(e) => onChange({ validFrom: e.target.value })} />}
        </Field>
        <Field id={`${id}-to`} label={t("validTo")} error={err(`${p}.validTo`)}>
          {(c) => <Input {...c} type="date" value={row.validTo} onChange={(e) => onChange({ validTo: e.target.value })} />}
        </Field>
      </div>
      <Field id={`${id}-notes`} label={t("rightNotes")} error={err(`${p}.notes`)}>
        {(c) => <Input {...c} value={row.notes} onChange={(e) => onChange({ notes: e.target.value })} maxLength={500} />}
      </Field>
    </RowShell>
  );
}

function CadastralFields({
  row,
  index,
  err,
  onChange,
  onRemove,
}: {
  row: CadastralRow;
  index: number;
  err: ErrFn;
  onChange: (patch: Partial<CadastralRow>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("assets.form");
  const id = `cad-${row.key}`;
  const p = `cadastral.${index}`;
  const text = (field: keyof CadastralRow, label: string, extra?: { hint?: string; type?: string; max?: number }) => (
    <Field id={`${id}-${field}`} label={label} hint={extra?.hint} error={err(`${p}.${field === "income" ? "income" : field}`)}>
      {(c) => <Input {...c} type={extra?.type} maxLength={extra?.max ?? 40} value={row[field]} onChange={(e) => onChange({ [field]: e.target.value })} />}
    </Field>
  );
  return (
    <RowShell title={`${t("cadastralRow")} ${index + 1}`} onRemove={onRemove}>
      <div className="grid gap-4 sm:grid-cols-3">
        {text("sheet", t("sheet"), { max: 20 })}
        {text("parcel", t("parcel"), { max: 20 })}
        {text("subunit", t("subunit"), { max: 20 })}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {text("cadastralCategory", t("cadastralCategory"), { max: 20 })}
        {text("cadastralClass", t("cadastralClass"), { max: 20 })}
        {text("consistency", t("consistency"))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {text("income", t("income"), { hint: t("incomeHint"), max: 20 })}
        {text("validFrom", t("validFrom"), { type: "date" })}
        {text("validTo", t("validTo"), { type: "date" })}
      </div>
      {text("notes", t("cadastralNotes"), { max: 500 })}
    </RowShell>
  );
}

function LinkFields({
  row,
  index,
  otherAssets,
  err,
  onChange,
  onRemove,
}: {
  row: LinkRow;
  index: number;
  otherAssets: AssetOption[];
  err: ErrFn;
  onChange: (patch: Partial<LinkRow>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("assets.form");
  const tr = useTranslations("assets");
  const id = `link-${row.key}`;
  const p = `links.${index}`;
  return (
    <RowShell title={`${t("link")} ${index + 1}`} onRemove={onRemove}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-main`} label={t("linkMain")} error={err(`${p}.mainAssetId`)}>
          {(c) => (
            <NativeSelect {...c} value={row.mainAssetId} onChange={(e) => onChange({ mainAssetId: e.target.value })}>
              <option value="">{t("linkChoose")}</option>
              {otherAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id={`${id}-status`} label={t("linkStatus")} error={err(`${p}.validationStatus`)}>
          {(c) => (
            <NativeSelect {...c} value={row.validationStatus} onChange={(e) => onChange({ validationStatus: e.target.value })}>
              {LINK_VALIDATION.map((s) => (
                <option key={s} value={s}>
                  {tr(`linkValidation.${s}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <Field id={`${id}-basis`} label={t("linkBasis")} error={err(`${p}.declaredBasis`)}>
        {(c) => <Input {...c} value={row.declaredBasis} onChange={(e) => onChange({ declaredBasis: e.target.value })} maxLength={500} />}
      </Field>
    </RowShell>
  );
}

function AttributeFields({
  row,
  index,
  err,
  onChange,
  onRemove,
}: {
  row: AttributeRow;
  index: number;
  err: ErrFn;
  onChange: (patch: Partial<AttributeRow>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("assets.form");
  const id = `attr-${row.key}`;
  const p = `attributes.${index}`;
  return (
    <RowShell title={`${t("attribute")} ${index + 1}`} onRemove={onRemove}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`${id}-name`} label={t("attributeName")} hint={t("attributeNameHint")} error={err(`${p}.key`)}>
          {(c) => <Input {...c} value={row.name} onChange={(e) => onChange({ name: e.target.value })} maxLength={40} />}
        </Field>
        <Field id={`${id}-type`} label={t("attributeType")} error={err(`${p}.type`)}>
          {(c) => (
            <NativeSelect {...c} value={row.type} onChange={(e) => onChange({ type: e.target.value, value: e.target.value === "boolean" ? "true" : row.value })}>
              {ATTRIBUTE_TYPES.map((a) => (
                <option key={a} value={a}>
                  {t(`attributeTypes.${a}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id={`${id}-value`} label={t("attributeValue")} error={err(`${p}.value`)}>
          {(c) =>
            row.type === "boolean" ? (
              <NativeSelect {...c} value={row.value} onChange={(e) => onChange({ value: e.target.value })}>
                <option value="true">{t("attributeYes")}</option>
                <option value="false">{t("attributeNo")}</option>
              </NativeSelect>
            ) : (
              <Input {...c} inputMode={row.type === "number" ? "decimal" : undefined} value={row.value} onChange={(e) => onChange({ value: e.target.value })} maxLength={200} />
            )
          }
        </Field>
      </div>
    </RowShell>
  );
}
