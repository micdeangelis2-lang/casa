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
import { CalcEditor } from "@/components/calc-editor";
import { TerritoryPicker } from "@/components/territory-picker";
import { DEADLINE_CATEGORIES, PRIORITIES } from "@/shared/deadline-vocab";
import { ASSET_KINDS, RIGHT_TYPES, USE_TYPES } from "@/modules/assets/client";
import { LETTING_TYPES } from "@/modules/lettings/client";
import { RULE_LEVELS, RULE_VERIFICATION, type RuleLevel, type RuleVerification } from "@/modules/rules/client";
import type { FieldErrors } from "@/shared/result";
import type { SaveResult } from "../actions";
import {
  FACT_KINDS,
  OPS_BY_FACT,
  formToPayload,
  newConditionRow,
  newOutcomeRow,
  type ConditionRow,
  type FactKind,
  type OutcomeRow,
  type RuleFormValues,
  type ValueType,
} from "../rule-form-state";
import { ConditionText } from "./condition-text";

export type CategoryOption = { code: string; name: string };

type Props = {
  mode: "create" | "edit";
  initial: RuleFormValues;
  dossierCategories: CategoryOption[];
  documentCategories: CategoryOption[];
  /** Numero della versione che si creera' salvando (solo in modifica). */
  nextVersionNo?: number;
  onSubmit: (payload: unknown) => Promise<SaveResult>;
  cancelHref: string;
};

export function RuleForm({ mode, initial, dossierCategories, documentCategories, nextVersionNo, onSubmit, cancelHref }: Props) {
  const t = useTranslations("rules");
  const tf = useTranslations("rules.form");
  const tc = useTranslations("common");
  const [values, setValues] = useState<RuleFormValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const summaryRef = useRef<HTMLDivElement>(null);

  const err = (path: string) => errors[path]?.[0];
  const set = <K extends keyof RuleFormValues>(key: K, value: RuleFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const patchRow = (key: string, patch: Partial<ConditionRow>) => setValues((v) => ({ ...v, rows: v.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const patchOutcome = (key: string, patch: Partial<OutcomeRow>) => setValues((v) => ({ ...v, outcomes: v.outcomes.map((o) => (o.key === key ? { ...o, ...patch } : o)) }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await onSubmit(formToPayload(values));
      // Con successo la azione reindirizza e non torna qui; se torna, ci sono errori da mostrare.
      if (result?.errors) {
        setErrors(result.errors);
        requestAnimationFrame(() => summaryRef.current?.focus());
      }
    });
  }

  const errorList = Object.entries(errors).flatMap(([path, messages]) => messages.map((m) => ({ path, message: m })));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{mode === "create" ? tf("titleNew") : tf("titleEdit")}</h1>
        <p className="text-sm text-muted-foreground">
          {mode === "create" ? tf("intro") : tf("titleEditHint", { number: nextVersionNo ?? 2 })}
        </p>
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
        <legend className="mb-2 text-lg font-medium">{tf("basics")}</legend>
        <Field id="title" label={tf("ruleTitle")} error={err("title")}>
          {(p) => <Input {...p} value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={200} />}
        </Field>
        <Field id="description" label={tf("description")} error={err("description")}>
          {(p) => <Textarea {...p} rows={3} value={values.description} onChange={(e) => set("description", e.target.value)} maxLength={1000} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="level" label={tf("level")} hint={tf("levelHint")} error={err("level")}>
            {(p) => (
              <NativeSelect {...p} value={values.level} onChange={(e) => set("level", e.target.value as RuleLevel)}>
                {RULE_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`level.${l}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="territory" label={tf("territory")} hint={tf("territoryHint")} error={err("territoryId")}>
            {(p) => (
              <TerritoryPicker
                id={p.id}
                kinds={["country", "region", "province", "municipality", "locality"]}
                value={values.territory}
                onChange={(v) => set("territory", v)}
                invalid={p["aria-invalid"]}
                describedBy={p["aria-describedby"]}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="validFrom" label={tf("validFrom")} error={err("validFrom")}>
            {(p) => <Input {...p} type="date" value={values.validFrom} onChange={(e) => set("validFrom", e.target.value)} />}
          </Field>
          <Field id="validTo" label={tf("validTo")} hint={tf("validityHint")} error={err("validTo")}>
            {(p) => <Input {...p} type="date" value={values.validTo} onChange={(e) => set("validTo", e.target.value)} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-medium">{tf("when")}</legend>
        <p className="text-sm text-muted-foreground">{tf("whenHint")}</p>
        {values.conditionMode === "locked" ? (
          <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
            <p className="text-muted-foreground">{tf("locked")}</p>
            <ConditionText condition={values.locked} />
            <Button type="button" variant="outline" className="self-start" onClick={() => setValues((v) => ({ ...v, conditionMode: "always", locked: null, rows: [] }))}>
              {tf("lockedReplace")}
            </Button>
          </div>
        ) : (
          <>
            <Field id="mode" label={tf("mode")} error={err("appliesWhen")}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={values.conditionMode}
                  onChange={(e) => {
                    const mode = e.target.value as "always" | "all" | "any";
                    setValues((v) => ({ ...v, conditionMode: mode, rows: mode !== "always" && v.rows.length === 0 ? [newConditionRow()] : v.rows }));
                  }}
                >
                  <option value="always">{tf("modeAlways")}</option>
                  <option value="all">{tf("modeAll")}</option>
                  <option value="any">{tf("modeAny")}</option>
                </NativeSelect>
              )}
            </Field>
            {values.conditionMode !== "always" ? (
              <>
                {values.rows.map((row, i) => (
                  <ConditionFields
                    key={row.key}
                    row={row}
                    index={i}
                    err={err}
                    onChange={(patch) => patchRow(row.key, patch)}
                    onRemove={() => setValues((v) => ({ ...v, rows: v.rows.filter((r) => r.key !== row.key) }))}
                  />
                ))}
                <Button type="button" variant="outline" className="self-start" onClick={() => setValues((v) => ({ ...v, rows: [...v.rows, newConditionRow()] }))}>
                  <Plus aria-hidden /> {tf("addCondition")}
                </Button>
              </>
            ) : null}
          </>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-medium">{tf("outcomes")}</legend>
        <p className="text-sm text-muted-foreground">{tf("outcomesHint")}</p>
        {err("outcomes") ? <p className="text-sm text-destructive">{err("outcomes")}</p> : null}
        {values.outcomes.map((o, i) => (
          <OutcomeFields
            key={o.key}
            row={o}
            index={i}
            dossierCategories={dossierCategories}
            documentCategories={documentCategories}
            err={err}
            onChange={(patch) => patchOutcome(o.key, patch)}
            onRemove={() => setValues((v) => ({ ...v, outcomes: v.outcomes.filter((x) => x.key !== o.key) }))}
          />
        ))}
        <Button type="button" variant="outline" className="self-start" onClick={() => setValues((v) => ({ ...v, outcomes: [...v.outcomes, newOutcomeRow()] }))}>
          <Plus aria-hidden /> {tf("addOutcome")}
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-medium">{tf("source")}</legend>
        <Field id="sourceText" label={tf("sourceText")} hint={tf("sourceTextHint")} error={err("sourceText")}>
          {(p) => <Textarea {...p} rows={2} value={values.sourceText} onChange={(e) => set("sourceText", e.target.value)} maxLength={500} />}
        </Field>
        <Field id="sourceUrl" label={tf("sourceUrl")} error={err("sourceUrl")}>
          {(p) => <Input {...p} type="url" inputMode="url" value={values.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} maxLength={500} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="verificationStatus" label={tf("verification")} error={err("verificationStatus")}>
            {(p) => (
              <NativeSelect {...p} value={values.verificationStatus} onChange={(e) => set("verificationStatus", e.target.value as RuleVerification)}>
                {RULE_VERIFICATION.map((s) => (
                  <option key={s} value={s}>
                    {t(`verification.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="changeNote" label={tf("changeNote")} error={err("changeNote")}>
            {(p) => <Input {...p} value={values.changeNote} onChange={(e) => set("changeNote", e.target.value)} maxLength={300} />}
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? tf("saving") : mode === "create" ? tf("submitNew") : tf("submitEdit")}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "ghost" })}>
          {tf("cancel")}
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

const defaultValueFor = (fact: FactKind): string => (fact === "asset.kind" ? ASSET_KINDS[0] : fact === "asset.useType" ? USE_TYPES[0] : fact === "asset.inCondominium" ? "true" : fact === "rights.regimes" ? RIGHT_TYPES[0] : fact === "letting.types" ? LETTING_TYPES[0] : "");

function ConditionFields({ row, index, err, onChange, onRemove }: { row: ConditionRow; index: number; err: ErrFn; onChange: (patch: Partial<ConditionRow>) => void; onRemove: () => void }) {
  const t = useTranslations("rules");
  const tf = useTranslations("rules.form");
  const ta = useTranslations("assets");
  const tl = useTranslations("lettings");
  const id = `cond-${row.key}`;
  const p = `appliesWhen`;
  const ops = OPS_BY_FACT[row.factKind];

  const enumOptions: { value: string; label: string }[] =
    row.factKind === "asset.kind"
      ? ASSET_KINDS.map((k) => ({ value: k, label: ta(`kind.${k}`) }))
      : row.factKind === "asset.useType"
        ? USE_TYPES.map((u) => ({ value: u, label: ta(`use.${u}`) }))
        : row.factKind === "rights.regimes"
          ? RIGHT_TYPES.map((r) => ({ value: r, label: ta(`right.${r}`) }))
          : row.factKind === "letting.types"
            ? LETTING_TYPES.map((k) => ({ value: k, label: tl(`types.${k}`) }))
            : [];

  const changeFact = (factKind: FactKind) => {
    const allowed = OPS_BY_FACT[factKind];
    onChange({ factKind, op: allowed.includes(row.op) ? row.op : allowed[0]!, value: defaultValueFor(factKind), list: [], valueType: "text" });
  };

  return (
    <RowShell title={`${tf("condition")} ${index + 1}`} onRemove={onRemove}>
      <div className="flex items-center gap-2">
        <Checkbox id={`${id}-neg`} checked={row.negate} onCheckedChange={(v) => onChange({ negate: v === true })} />
        <Label htmlFor={`${id}-neg`}>{tf("negate")}</Label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-fact`} label={tf("fact")} error={err(p)}>
          {(c) => (
            <NativeSelect {...c} value={row.factKind} onChange={(e) => changeFact(e.target.value as FactKind)}>
              {FACT_KINDS.map((f) => (
                <option key={f} value={f}>
                  {f === "attribute" ? tf("factOther") : t(`facts.${f}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        {row.factKind === "attribute" ? (
          <Field id={`${id}-attr`} label={tf("attributeName")} hint={tf("attributeNameHint")}>
            {(c) => <Input {...c} value={row.attrName} onChange={(e) => onChange({ attrName: e.target.value })} maxLength={40} />}
          </Field>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-op`} label={tf("operator")}>
          {(c) => (
            <NativeSelect {...c} value={row.op} onChange={(e) => onChange({ op: e.target.value as ConditionRow["op"] })}>
              {ops.map((o) => (
                <option key={o} value={o}>
                  {t(`ops.${o}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        {row.op === "exists" ? null : row.factKind === "asset.inCondominium" ? (
          <Field id={`${id}-value`} label={tf("value")}>
            {(c) => (
              <NativeSelect {...c} value={row.value} onChange={(e) => onChange({ value: e.target.value })}>
                <option value="true">{t("text.yes")}</option>
                <option value="false">{t("text.no")}</option>
              </NativeSelect>
            )}
          </Field>
        ) : row.factKind !== "attribute" && row.op === "in" ? (
          <div role="group" aria-labelledby={`${id}-list`} className="flex flex-col gap-2">
            <span id={`${id}-list`} className="text-sm font-medium">
              {tf("value")}
            </span>
            {enumOptions.map((o) => (
              <div key={o.value} className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-v-${o.value}`}
                  checked={row.list.includes(o.value)}
                  onCheckedChange={(v) => onChange({ list: v === true ? [...row.list, o.value] : row.list.filter((x) => x !== o.value) })}
                />
                <Label htmlFor={`${id}-v-${o.value}`}>{o.label}</Label>
              </div>
            ))}
          </div>
        ) : row.factKind !== "attribute" ? (
          <Field id={`${id}-value`} label={tf("value")}>
            {(c) => (
              <NativeSelect {...c} value={row.value} onChange={(e) => onChange({ value: e.target.value })}>
                {enumOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : row.op === "in" ? (
          <Field id={`${id}-value`} label={tf("valueList")}>
            {(c) => <Textarea {...c} rows={3} value={row.value} onChange={(e) => onChange({ value: e.target.value })} />}
          </Field>
        ) : (
          <Field id={`${id}-value`} label={tf("value")}>
            {(c) =>
              row.valueType === "boolean" && row.op === "eq" ? (
                <NativeSelect {...c} value={row.value || "true"} onChange={(e) => onChange({ value: e.target.value })}>
                  <option value="true">{t("text.yes")}</option>
                  <option value="false">{t("text.no")}</option>
                </NativeSelect>
              ) : (
                <Input {...c} inputMode={row.op === "gte" || row.op === "lte" || row.valueType === "number" ? "decimal" : undefined} value={row.value} onChange={(e) => onChange({ value: e.target.value })} maxLength={200} />
              )
            }
          </Field>
        )}
      </div>
      {row.factKind === "attribute" && (row.op === "eq" || row.op === "in") ? (
        <Field id={`${id}-type`} label={tf("valueType")} className="sm:max-w-xs">
          {(c) => (
            <NativeSelect {...c} value={row.valueType} onChange={(e) => onChange({ valueType: e.target.value as ValueType, value: e.target.value === "boolean" ? "true" : row.value })}>
              {(["text", "number", "boolean"] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`valueTypes.${v}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      ) : null}
    </RowShell>
  );
}

function OutcomeFields({
  row,
  index,
  dossierCategories,
  documentCategories,
  err,
  onChange,
  onRemove,
}: {
  row: OutcomeRow;
  index: number;
  dossierCategories: CategoryOption[];
  documentCategories: CategoryOption[];
  err: ErrFn;
  onChange: (patch: Partial<OutcomeRow>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("rules");
  const tf = useTranslations("rules.form");
  const tc = useTranslations("common");
  const td = useTranslations("deadlines");
  const id = `out-${row.key}`;
  const p = `outcomes.${index}`;
  return (
    <RowShell title={`${tf("outcome")} ${index + 1}`} onRemove={onRemove}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`${id}-type`} label={tf("outcomeType")} error={err(`${p}.type`)}>
          {(c) => (
            <NativeSelect {...c} value={row.type} onChange={(e) => onChange({ type: e.target.value as OutcomeRow["type"] })}>
              <option value="checklist">{t("outcomeTypes.checklist")}</option>
              <option value="notice">{t("outcomeTypes.notice")}</option>
              <option value="deadline">{t("outcomeTypes.deadline")}</option>
            </NativeSelect>
          )}
        </Field>
        <Field id={`${id}-code`} label={tf("outcomeKey")} hint={tf("outcomeKeyHint")} error={err(`${p}.key`)} className="sm:col-span-2">
          {(c) => <Input {...c} value={row.code} onChange={(e) => onChange({ code: e.target.value })} maxLength={40} />}
        </Field>
      </div>
      <Field id={`${id}-title`} label={tf("outcomeTitle")} error={err(`${p}.title`)}>
        {(c) => <Input {...c} value={row.title} onChange={(e) => onChange({ title: e.target.value })} maxLength={200} />}
      </Field>
      {row.type === "checklist" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-cat`} label={tf("dossierCategory")} error={err(`${p}.dossierCategory`)}>
              {(c) => (
                <NativeSelect {...c} value={row.dossierCategory} onChange={(e) => onChange({ dossierCategory: e.target.value })}>
                  <option value="">{tc("notIndicated")}</option>
                  {dossierCategories.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field id={`${id}-doccat`} label={tf("expectedDocumentCategory")} error={err(`${p}.expectedDocumentCategory`)}>
              {(c) => (
                <NativeSelect {...c} value={row.expectedDocumentCategory} onChange={(e) => onChange({ expectedDocumentCategory: e.target.value })}>
                  <option value="">{tf("none")}</option>
                  {documentCategories.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          <Field id={`${id}-note`} label={tf("outcomeNote")} error={err(`${p}.note`)}>
            {(c) => <Input {...c} value={row.note} onChange={(e) => onChange({ note: e.target.value })} maxLength={500} />}
          </Field>
        </>
      ) : row.type === "notice" ? (
        <Field id={`${id}-msg`} label={tf("message")} error={err(`${p}.message`)}>
          {(c) => <Textarea {...c} rows={2} value={row.message} onChange={(e) => onChange({ message: e.target.value })} maxLength={600} />}
        </Field>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-dcat`} label={tf("deadlineCategory")} error={err(`${p}.category`)}>
              {(c) => (
                <NativeSelect {...c} value={row.deadlineCategory} onChange={(e) => onChange({ deadlineCategory: e.target.value })}>
                  {DEADLINE_CATEGORIES.map((d) => (
                    <option key={d} value={d}>
                      {td(`category.${d}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field id={`${id}-prio`} label={tf("deadlinePriority")} error={err(`${p}.priority`)}>
              {(c) => (
                <NativeSelect {...c} value={row.priority} onChange={(e) => onChange({ priority: e.target.value })}>
                  {PRIORITIES.map((x) => (
                    <option key={x} value={x}>
                      {td(`priority.${x}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          <fieldset className="flex flex-col gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{tf("deadlineCalc")}</legend>
            <CalcEditor id={`${id}-calc`} value={row.calc} onChange={(patch) => onChange({ calc: { ...row.calc, ...patch } })} error={err} path={`${p}.calc`} />
          </fieldset>
          <div className="flex items-center gap-2">
            <Checkbox id={`${id}-shift`} checked={row.shift} onCheckedChange={(v) => onChange({ shift: v === true })} />
            <Label htmlFor={`${id}-shift`}>{tf("deadlineShift")}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id={`${id}-proof`} checked={row.proof} onCheckedChange={(v) => onChange({ proof: v === true })} />
            <Label htmlFor={`${id}-proof`}>{tf("deadlineProof")}</Label>
          </div>
          <Field id={`${id}-basis`} label={tf("deadlineLegalBasis")} error={err(`${p}.legalBasis`)}>
            {(c) => <Input {...c} value={row.legalBasis} onChange={(e) => onChange({ legalBasis: e.target.value })} maxLength={500} />}
          </Field>
          <Field id={`${id}-cons`} label={tf("deadlineConsequences")} error={err(`${p}.consequences`)}>
            {(c) => <Input {...c} value={row.consequences} onChange={(e) => onChange({ consequences: e.target.value })} maxLength={1000} />}
          </Field>
          <Field id={`${id}-docs`} label={tf("deadlineDocuments")} error={err(`${p}.requiredDocuments`)}>
            {(c) => <Input {...c} value={row.requiredDocuments} onChange={(e) => onChange({ requiredDocuments: e.target.value })} maxLength={1000} />}
          </Field>
        </>
      )}
    </RowShell>
  );
}
