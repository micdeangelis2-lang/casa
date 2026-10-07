"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/form-field";
import { TerritoryPicker, type TerritoryChoice } from "@/components/territory-picker";
import type { FieldErrors } from "@/shared/result";
import { addTerritoryAction } from "../actions";

/** Cosa puo' contenere ciascun tipo: una localita' sta in un Comune, un Comune in una provincia, una provincia in una regione. */
const PARENT_KINDS = { locality: "municipality", municipality: "province", province: "region" } as const;
type ManualKind = keyof typeof PARENT_KINDS;
const KINDS: ManualKind[] = ["locality", "municipality", "province"];

export function TerritoryForm() {
  const t = useTranslations("territories");
  const router = useRouter();
  const [kind, setKind] = useState<ManualKind>("locality");
  const [parent, setParent] = useState<TerritoryChoice | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [cadastralCode, setCadastralCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [added, setAdded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const err = (key: string) => errors[key]?.[0];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setAdded(null);
    startTransition(async () => {
      const result = await addTerritoryAction({ kind, parentId: parent?.id ?? "", name, code, cadastralCode });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setAdded(result.label);
      setName("");
      setCode("");
      setCadastralCode("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">{t("addTitle")}</h2>
      {added ? (
        <Alert>
          <AlertDescription>
            {t("added")} ({added})
          </AlertDescription>
        </Alert>
      ) : null}
      {err("_") ? (
        <Alert variant="destructive">
          <AlertDescription>{err("_")}</AlertDescription>
        </Alert>
      ) : null}

      <Field id="t-kind" label={t("addKind")} error={err("kind")}>
        {(p) => (
          <NativeSelect
            {...p}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ManualKind);
              setParent(null); // il livello superiore cambia con il tipo
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
      <Field id="t-parent" label={`${t("addParent")} (${t(`kind.${PARENT_KINDS[kind]}`)})`} hint={t("addParentHint")} error={err("parentId")}>
        {(p) => (
          <TerritoryPicker
            key={kind}
            id={p.id}
            kinds={[PARENT_KINDS[kind]]}
            value={parent}
            onChange={setParent}
            invalid={p["aria-invalid"]}
            describedBy={p["aria-describedby"]}
          />
        )}
      </Field>
      <Field id="t-name" label={t("addName")} error={err("name")}>
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}
      </Field>
      <Field id="t-code" label={`${t("addCode")}`} error={err("code")}>
        {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} />}
      </Field>
      {kind === "municipality" ? (
        <Field id="t-cad" label={t("addCadastral")} hint={t("addCadastralHint")} error={err("cadastralCode")}>
          {(p) => <Input {...p} value={cadastralCode} onChange={(e) => setCadastralCode(e.target.value)} maxLength={4} />}
        </Field>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
