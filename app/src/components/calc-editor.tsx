"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/form-field";
import type { CalcFields } from "@/shared/calc-form";

type Props = {
  /** Prefisso degli id (unico nella pagina). */
  id: string;
  value: CalcFields;
  onChange: (patch: Partial<CalcFields>) => void;
  /** Errori per campo del calcolo (percorsi del server, es. `calc.month`). */
  error?: (path: string) => string | undefined;
  /** Percorso base degli errori. */
  path?: string;
};

/** Editor a moduli della regola di calcolo di una scadenza: mostra solo i campi del tipo scelto. */
export function CalcEditor({ id, value, onChange, error, path = "calc" }: Props) {
  const t = useTranslations("calc");
  const err = (p: string) => error?.(`${path}.${p}`);
  const needsAnchor = value.calcType === "relative_to" || value.calcType === "recurring";

  return (
    <div className="flex flex-col gap-4">
      <Field id={`${id}-type`} label={t("type")} hint={t(`typeHint.${value.calcType as "fixed_annual" | "relative_to" | "recurring" | "manual"}`)} error={error?.(path)}>
        {(p) => (
          <NativeSelect {...p} value={value.calcType} onChange={(e) => onChange({ calcType: e.target.value })}>
            {(["fixed_annual", "relative_to", "recurring", "manual"] as const).map((c) => (
              <option key={c} value={c}>
                {t(`types.${c}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      {value.calcType === "fixed_annual" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-day`} label={t("day")} error={err("day")}>
            {(p) => <Input {...p} inputMode="numeric" value={value.day} onChange={(e) => onChange({ day: e.target.value })} />}
          </Field>
          <Field id={`${id}-month`} label={t("month")} error={err("month")}>
            {(p) => (
              <NativeSelect {...p} value={value.month} onChange={(e) => onChange({ month: e.target.value })}>
                <option value="">{t("choose")}</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={String(i + 1)}>
                    {t(`months.${(i + 1) as 1}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
      ) : null}

      {needsAnchor ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-anchorKind`} label={t("anchorKind")} error={err("anchor")}>
              {(p) => (
                <NativeSelect {...p} value={value.anchorKind} onChange={(e) => onChange({ anchorKind: e.target.value })}>
                  <option value="date">{t("anchorDate")}</option>
                  <option value="attribute">{t("anchorAttribute")}</option>
                </NativeSelect>
              )}
            </Field>
            {value.anchorKind === "date" ? (
              <Field id={`${id}-anchorDateValue`} label={t("anchorDateValue")} error={err("anchor.date")}>
                {(p) => <Input {...p} type="date" value={value.anchorDate} onChange={(e) => onChange({ anchorDate: e.target.value })} />}
              </Field>
            ) : (
              <Field id={`${id}-anchorAttributeValue`} label={t("anchorAttributeValue")} hint={t("anchorAttributeHint")} error={err("anchor.name")}>
                {(p) => <Input {...p} value={value.anchorAttribute} onChange={(e) => onChange({ anchorAttribute: e.target.value })} maxLength={40} />}
              </Field>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-amount`} label={value.calcType === "recurring" ? t("every") : t("offset")} hint={value.calcType === "relative_to" ? t("offsetHint") : undefined} error={err(value.calcType === "recurring" ? "every.amount" : "offset.amount")}>
              {(p) => <Input {...p} inputMode="numeric" value={value.amount} onChange={(e) => onChange({ amount: e.target.value })} />}
            </Field>
            <Field id={`${id}-unit`} label={t("unit")} error={err(value.calcType === "recurring" ? "every.unit" : "offset.unit")}>
              {(p) => (
                <NativeSelect {...p} value={value.unit} onChange={(e) => onChange({ unit: e.target.value })}>
                  {(["days", "months", "years"] as const).map((u) => (
                    <option key={u} value={u}>
                      {t(`units.${u}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
        </>
      ) : null}
    </div>
  );
}
