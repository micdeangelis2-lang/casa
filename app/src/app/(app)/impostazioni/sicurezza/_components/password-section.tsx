"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "../actions";
import { Feedback } from "./feedback";

export function PasswordSection() {
  const t = useTranslations("securityPage.password");
  const te = useTranslations("securityPage.errors");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokeOthers, setRevokeOthers] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    // Il componente Checkbox non e' un input nativo: il valore si aggiunge a mano.
    if (revokeOthers) data.set("revokeOthers", "on");
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await changePasswordAction(data);
      if (result.ok) {
        form.reset();
        setMessage(t("done"));
      } else {
        setError(te(result.error));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("heading")}</h2>
        </CardTitle>
        <CardDescription>{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
          <Feedback message={message} error={error} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw-current">{t("current")}</Label>
            <Input id="pw-current" name="currentPassword" type="password" autoComplete="current-password" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw-new">{t("new")}</Label>
            <Input
              id="pw-new"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              aria-describedby="pw-new-hint"
            />
            <p id="pw-new-hint" className="text-sm text-muted-foreground">
              {t("newHint")}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw-confirm">{t("confirm")}</Label>
            <Input id="pw-confirm" name="confirmPassword" type="password" autoComplete="new-password" required />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="pw-revoke" checked={revokeOthers} onCheckedChange={(value) => setRevokeOthers(value === true)} />
            <Label htmlFor="pw-revoke">{t("revokeOthers")}</Label>
          </div>
          <Button type="submit" variant="secondary" disabled={pending} className="self-start">
            {pending ? t("working") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
