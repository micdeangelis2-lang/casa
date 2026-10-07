"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import QRCode from "react-qr-code";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasskeyAddForm } from "@/components/passkey-add-form";
import { authClient } from "@/lib/auth-client";

type Enrollment = { totpURI: string; backupCodes: string[] };

export function SecuritySetup({
  twoFactorEnabled,
  passkeys,
}: {
  twoFactorEnabled: boolean;
  passkeys: { id: string; name: string | null }[];
}) {
  const t = useTranslations("auth.security");
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [totpDone, setTotpDone] = useState(twoFactorEnabled);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"totp" | null>(null);

  const complete = totpDone && passkeys.length >= 1;
  const manualKey = enrollment ? new URL(enrollment.totpURI).searchParams.get("secret") : null;

  async function startEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    const result = await authClient.twoFactor.enable({ password, method: "totp" });
    setBusy(false);
    if (result.error || !result.data || !("totpURI" in result.data)) {
      setError("totp");
      return;
    }
    setEnrollment({ totpURI: result.data.totpURI, backupCodes: result.data.backupCodes });
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setBusy(true);
    setError(null);
    const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    setBusy(false);
    if (result.error) {
      setError("totp");
      return;
    }
    // I codici non si mostrano piu': dopo l'attivazione se ne perde ogni traccia lato client.
    setEnrollment(null);
    setSaved(false);
    setTotpDone(true);
    router.refresh();
  }

  async function copyCodes() {
    if (!enrollment) return;
    await navigator.clipboard.writeText(enrollment.backupCodes.join("\n"));
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("totp.title")}</h2>
          </CardTitle>
          <CardDescription>{totpDone ? t("totp.enabled") : t("totp.body")}</CardDescription>
        </CardHeader>
        {!totpDone ? (
          <CardContent>
            {error === "totp" ? (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{t("totp.error")}</AlertDescription>
              </Alert>
            ) : null}

            {!enrollment ? (
              <form onSubmit={startEnrollment} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password">{t("totp.password")}</Label>
                  <Input id="password" name="password" type="password" autoComplete="current-password" required />
                </div>
                <Button type="submit" disabled={busy}>
                  {busy ? t("totp.starting") : t("totp.start")}
                </Button>
              </form>
            ) : (
              <form onSubmit={verifyEnrollment} className="flex flex-col gap-6">
                <div className="flex flex-col items-start gap-3">
                  <div className="rounded-md bg-white p-3" role="img" aria-label={t("totp.qrLabel")}>
                    <QRCode value={enrollment.totpURI} size={176} />
                  </div>
                  {manualKey ? (
                    <p className="text-sm text-muted-foreground">
                      {t("totp.manualKey")}: <code className="font-mono break-all text-foreground">{manualKey}</code>
                    </p>
                  ) : null}
                </div>

                <section className="flex flex-col gap-3" aria-labelledby="backup-title">
                  <h3 id="backup-title" className="font-medium">
                    {t("backup.title")}
                  </h3>
                  <p className="text-sm text-muted-foreground">{t("backup.body")}</p>
                  <ul className="grid grid-cols-2 gap-2 font-mono text-sm" data-testid="backup-codes">
                    {enrollment.backupCodes.map((code) => (
                      <li key={code} className="rounded-md border bg-muted px-2 py-1">
                        {code}
                      </li>
                    ))}
                  </ul>
                  <Button type="button" variant="outline" size="sm" className="self-start" onClick={copyCodes}>
                    {copied ? t("backup.copied") : t("backup.copy")}
                  </Button>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="saved"
                      checked={saved}
                      onCheckedChange={(value) => setSaved(value === true)}
                    />
                    <Label htmlFor="saved">{t("backup.saved")}</Label>
                  </div>
                </section>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="code">{t("totp.code")}</Label>
                  <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
                </div>
                <Button type="submit" disabled={busy || !saved}>
                  {busy ? t("totp.verifying") : t("totp.verify")}
                </Button>
              </form>
            )}
          </CardContent>
        ) : null}
      </Card>

      <Card aria-disabled={!totpDone} className={totpDone ? undefined : "opacity-60"}>
        <CardHeader>
          <CardTitle>
            <h2>{t("passkey.title")}</h2>
          </CardTitle>
          <CardDescription>{t("passkey.body")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t("passkey.registered")}</h3>
            {passkeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("passkey.none")}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm" data-testid="passkey-list">
                {passkeys.map((p) => (
                  <li key={p.id}>{p.name || "Passkey"}</li>
                ))}
              </ul>
            )}
          </div>

          {totpDone ? (
            <PasskeyAddForm />
          ) : null}
        </CardContent>
      </Card>

      {complete ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("done.title")}</h2>
            </CardTitle>
            <CardDescription>{t("done.body")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/" className={buttonVariants()}>
              {t("done.go")}
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
