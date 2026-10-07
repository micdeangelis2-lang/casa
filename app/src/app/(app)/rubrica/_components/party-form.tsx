"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form-field";
import { PARTY_ROLES } from "@/modules/directory/client";
import type { FieldErrors } from "@/shared/result";
import { archivePartyAction, type SaveResult } from "../actions";
import type { PartyFormState } from "../party-form-state";

type Props = {
  mode: "create" | "edit";
  initial: PartyFormState;
  partyId?: string;
  archived?: boolean;
  onSubmit: (payload: unknown) => Promise<SaveResult>;
};

export function PartyForm({ mode, initial, partyId, archived, onSubmit }: Props) {
  const t = useTranslations("directory");
  const tc = useTranslations("common");
  const [state, setState] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const summaryRef = useRef<HTMLDivElement>(null);

  const err = (path: string) => errors[path]?.[0];
  const set = <K extends keyof PartyFormState>(key: K, value: PartyFormState[K]) => setState((s) => ({ ...s, [key]: value }));
  const toggleRole = (role: string, on: boolean) =>
    set("roles", on ? [...state.roles, role] : state.roles.filter((r) => r !== role));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await onSubmit(state);
      if (result?.errors) {
        setErrors(result.errors);
        requestAnimationFrame(() => summaryRef.current?.focus());
      }
    });
  }

  const errorList = Object.entries(errors).flatMap(([path, messages]) => messages.map((m) => ({ path, message: m })));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{mode === "create" ? t("form.titleNew") : t("form.titleEdit")}</h1>

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

      <Field id="displayName" label={t("form.displayName")} error={err("displayName")}>
        {(p) => <Input {...p} value={state.displayName} onChange={(e) => set("displayName", e.target.value)} maxLength={160} />}
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{t("form.roles")}</legend>
        <p className="text-sm text-muted-foreground">{t("form.rolesHint")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PARTY_ROLES.map((role) => (
            <div key={role} className="flex items-center gap-2">
              <Checkbox id={`role-${role}`} checked={state.roles.includes(role)} onCheckedChange={(v) => toggleRole(role, v === true)} />
              <Label htmlFor={`role-${role}`}>{t(`role.${role}`)}</Label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="email" label={t("form.email")} error={err("email")}>
          {(p) => <Input {...p} type="email" value={state.email} onChange={(e) => set("email", e.target.value)} maxLength={254} />}
        </Field>
        <Field id="pec" label={t("form.pec")} error={err("pec")}>
          {(p) => <Input {...p} type="email" value={state.pec} onChange={(e) => set("pec", e.target.value)} maxLength={254} />}
        </Field>
        <Field id="phone" label={t("form.phone")} error={err("phone")}>
          {(p) => <Input {...p} type="tel" value={state.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} />}
        </Field>
        <Field id="taxCode" label={t("form.taxCode")} error={err("taxCode")}>
          {(p) => <Input {...p} value={state.taxCode} onChange={(e) => set("taxCode", e.target.value)} maxLength={20} />}
        </Field>
      </div>
      <Field id="address" label={t("form.address")} error={err("address")}>
        {(p) => <Input {...p} value={state.address} onChange={(e) => set("address", e.target.value)} maxLength={300} />}
      </Field>
      <Field id="notes" label={t("form.notes")} error={err("notes")}>
        {(p) => <Textarea {...p} rows={4} value={state.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />}
      </Field>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("form.saving") : mode === "create" ? t("form.submitNew") : t("form.submitEdit")}
        </Button>
        <Link href="/rubrica" className={buttonVariants({ variant: "ghost" })}>
          {tc("cancel")}
        </Link>
        {mode === "edit" && partyId ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => startTransition(() => archivePartyAction(partyId, !archived))}>
            {archived ? t("form.restore") : t("form.archive")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
