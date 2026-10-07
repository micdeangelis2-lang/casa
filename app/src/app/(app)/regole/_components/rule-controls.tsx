"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Copy, Power, PowerOff, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { TerritoryPicker, type TerritoryChoice } from "@/components/territory-picker";
import { RULE_VERIFICATION } from "@/modules/rules/client";
import { cloneRuleAction, reevaluateAllAction, seedRulesAction, setRuleActiveAction, setVerificationAction } from "../actions";

/** Carica le regole di esempio; l'esempio comunale si lega al Comune scelto (facoltativo). */
export function SeedRules() {
  const t = useTranslations("rules.seed");
  const [municipality, setMunicipality] = useState<TerritoryChoice | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-w-md flex-col gap-2">
        <Label htmlFor="seed-municipality">{t("municipality")}</Label>
        <TerritoryPicker id="seed-municipality" kinds={["municipality"]} value={municipality} onChange={setMunicipality} />
      </div>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await seedRulesAction(municipality?.id ?? null);
              setMessage(result.ok ? t("done", { created: result.created, skipped: result.skipped }) : result.message);
            })
          }
        >
          {t("button")}
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

export function ReevaluateAll() {
  const t = useTranslations("rules.reevaluate");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await reevaluateAllAction();
              setMessage(t("done", { assets: result.assets, changed: result.changed }));
            })
          }
        >
          <RefreshCw aria-hidden /> {t("button")}
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

export function RuleActions({ ruleId, active }: { ruleId: string; active: boolean }) {
  const t = useTranslations("rules.detail");
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button type="button" variant="outline" disabled={pending} onClick={() => startTransition(() => cloneRuleAction(ruleId))}>
        <Copy aria-hidden /> {t("clone")}
      </Button>
      <Button type="button" variant="ghost" disabled={pending} onClick={() => startTransition(() => setRuleActiveAction(ruleId, !active))}>
        {active ? <PowerOff aria-hidden /> : <Power aria-hidden />}
        {active ? t("deactivate") : t("activate")}
      </Button>
    </>
  );
}

/** Stato di verifica di una versione: e' una revisione, non crea una nuova versione. */
export function VerificationForm({ ruleId, versionId, current }: { ruleId: string; versionId: string; current: string }) {
  const t = useTranslations("rules");
  const [status, setStatus] = useState(current);
  const [pending, startTransition] = useTransition();
  const id = `verification-${versionId}`;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{t("detail.verification")}</Label>
        <NativeSelect id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
          {RULE_VERIFICATION.map((s) => (
            <option key={s} value={s}>
              {t(`verification.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="button" variant="secondary" disabled={pending || status === current} onClick={() => startTransition(() => setVerificationAction(ruleId, versionId, status))}>
        {t("detail.saveVerification")}
      </Button>
    </div>
  );
}
