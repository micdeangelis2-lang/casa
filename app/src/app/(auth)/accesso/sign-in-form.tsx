"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";

type Step = "start" | "totp";
type Problem = "passkey" | "credentials" | "totp" | null;

export function SignInForm() {
  const t = useTranslations("auth.signIn");
  const router = useRouter();
  const [step, setStep] = useState<Step>("start");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);

  function finish() {
    router.replace("/");
    router.refresh();
  }

  // Compilazione automatica (conditional UI): se il browser la supporta, propone le passkey
  // salvate quando si seleziona il campo email. Errori e annullamenti sono silenziosi.
  useEffect(() => {
    let cancelled = false;
    async function preload() {
      if (
        typeof PublicKeyCredential === "undefined" ||
        !PublicKeyCredential.isConditionalMediationAvailable ||
        !(await PublicKeyCredential.isConditionalMediationAvailable())
      ) {
        return;
      }
      const result = await authClient.signIn.passkey({ autoFill: true });
      if (!cancelled && result?.data) finish();
    }
    void preload();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signInWithPasskey() {
    setBusy(true);
    setProblem(null);
    const result = await authClient.signIn.passkey();
    setBusy(false);
    if (result?.error) {
      setProblem("passkey");
      return;
    }
    finish();
  }

  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setProblem(null);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setBusy(false);
    if (result.error || !result.data) {
      setProblem("credentials");
      return;
    }
    if ("twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
      setStep("totp");
      return;
    }
    finish();
  }

  async function verifySecondFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setBusy(true);
    setProblem(null);
    // trustDevice resta falso: nessun dispositivo "fidato" che salti il secondo fattore.
    const result = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    setBusy(false);
    if (result.error) {
      setProblem("totp");
      return;
    }
    finish();
  }

  if (step === "totp") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{t("totp.title")}</h1>
          </CardTitle>
          <CardDescription>{t("totp.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={verifySecondFactor} className="flex flex-col gap-4">
            {problem === "totp" ? (
              <Alert variant="destructive">
                <AlertDescription>{t("totp.invalid")}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">{useBackupCode ? t("totp.backupCode") : t("totp.code")}</Label>
              <Input
                id="code"
                name="code"
                key={useBackupCode ? "backup" : "totp"}
                inputMode={useBackupCode ? "text" : "numeric"}
                autoComplete="one-time-code"
                autoFocus
                required
              />
            </div>
            <Button type="submit" disabled={busy}>
              {t("totp.verify")}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setUseBackupCode((v) => !v);
                setProblem(null);
              }}
            >
              {useBackupCode ? t("totp.useTotp") : t("totp.useBackup")}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("title")}</h1>
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {problem === "passkey" ? (
          <Alert variant="destructive">
            <AlertDescription>{t("passkeyError")}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="button" onClick={signInWithPasskey} disabled={busy}>
          <KeyRound aria-hidden />
          {busy ? t("passkeyWorking") : t("passkeyButton")}
        </Button>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Separator className="flex-1" />
          <span>{t("orPassword")}</span>
          <Separator className="flex-1" />
        </div>

        <form onSubmit={signInWithPassword} className="flex flex-col gap-4">
          {problem === "credentials" ? (
            <Alert variant="destructive">
              <AlertDescription>{t("invalidCredentials")}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="username webauthn" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>
            {busy ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
