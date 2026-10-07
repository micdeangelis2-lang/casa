"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

/**
 * Registrazione di una nuova passkey (nome facoltativo + cerimonia WebAuthn). Usato dalla prima configurazione
 * (`/sicurezza/configurazione`) e dalla pagina «Sicurezza dell'account». Dopo l'esito aggiorna la pagina.
 */
export function PasskeyAddForm({ idPrefix = "passkey" }: { idPrefix?: string }) {
  const t = useTranslations("auth.security.passkey");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"added" | "error" | null>(null);

  async function addPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Dopo un await `event.currentTarget` e' nullo: il form va letto prima.
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    setBusy(true);
    setOutcome(null);
    const result = await authClient.passkey.addPasskey({ name: name || undefined });
    setBusy(false);
    if (result?.error) {
      setOutcome("error");
      return;
    }
    form.reset();
    setOutcome("added");
    router.refresh();
  }

  return (
    <form onSubmit={addPasskey} className="flex flex-col gap-4">
      <div role="status">
        {outcome === "added" ? <p className="text-sm">{t("added")}</p> : null}
      </div>
      {outcome === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{t("error")}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-name`}>{t("name")}</Label>
        <Input id={`${idPrefix}-name`} name="name" placeholder={t("namePlaceholder")} maxLength={60} />
      </div>
      <Button type="submit" variant="secondary" disabled={busy} className="self-start">
        {busy ? t("adding") : t("add")}
      </Button>
    </form>
  );
}
