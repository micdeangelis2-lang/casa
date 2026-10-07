"use client";

import { useState, useTransition, type FormEvent } from "react";
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
import { reconfirmAfterPasskeyAction, reconfirmWithPasswordAction, type ReconfirmError, type ReconfirmResult } from "./actions";

/** Dove andare a riconferma avvenuta: una pagina si apre con il router, uno scarico (`/api/...`) con una navigazione del browser. */
function useGoTo() {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  return {
    downloading,
    go(target: string) {
      if (target.startsWith("/api/")) {
        setDownloading(true);
        window.location.assign(target);
      } else {
        router.replace(target);
        router.refresh();
      }
    },
  };
}

export function ReconfirmForm({ target, already }: { target: string; already: boolean }) {
  const t = useTranslations("reconfirm");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ReconfirmError | null>(null);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const { go, downloading } = useGoTo();

  function finish(result: ReconfirmResult) {
    if (result.ok) {
      setError(null);
      go(result.target);
    } else {
      setError(result.error);
    }
  }

  function withPasskey() {
    setError(null);
    startTransition(async () => {
      const signed = await authClient.signIn.passkey();
      if (!signed || signed.error) {
        setError("generic");
        return;
      }
      finish(await reconfirmAfterPasskeyAction(target));
    });
  }

  function withPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("ritorno", target);
    if (useBackupCode) data.set("useBackupCode", "on");
    setError(null);
    startTransition(async () => finish(await reconfirmWithPasswordAction(data)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("heading")}</h2>
        </CardTitle>
        <CardDescription>{t("validity")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div role="status" className="text-sm" data-testid="reconfirm-status">
          {downloading ? t("downloading") : already ? t("already") : null}
        </div>
        {error ? (
          <Alert variant="destructive" data-testid="reconfirm-error">
            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
          </Alert>
        ) : null}

        <Button type="button" onClick={withPasskey} disabled={pending}>
          <KeyRound aria-hidden />
          {pending ? t("working") : t("passkey")}
        </Button>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Separator className="flex-1" />
          <span>{t("orPassword")}</span>
          <Separator className="flex-1" />
        </div>

        <form onSubmit={withPassword} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="reconfirm-password">{t("password")}</Label>
            <Input id="reconfirm-password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reconfirm-code">{useBackupCode ? t("backupCode") : t("code")}</Label>
            <Input
              id="reconfirm-code"
              name="code"
              key={useBackupCode ? "backup" : "totp"}
              inputMode={useBackupCode ? "text" : "numeric"}
              autoComplete="one-time-code"
              required
            />
          </div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? t("working") : t("submit")}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setUseBackupCode((v) => !v);
              setError(null);
            }}
          >
            {useBackupCode ? t("useTotp") : t("useBackup")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
