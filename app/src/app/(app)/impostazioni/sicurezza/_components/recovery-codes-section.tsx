"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { regenerateRecoveryCodesAction } from "../actions";
import { Feedback } from "./feedback";

/**
 * I codici nuovi vivono solo nello stato di questo componente: si mostrano una volta, si possono copiare e poi si scartano.
 * Non vanno in log, in audit, nell'URL o in altro archivio.
 */
export function RecoveryCodesSection() {
  const t = useTranslations("securityPage.recovery");
  const te = useTranslations("securityPage.errors");
  const [pending, startTransition] = useTransition();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (codes) shownRef.current?.focus();
  }, [codes]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await regenerateRecoveryCodesAction(data);
      if (result.ok) {
        form.reset();
        setCodes(result.codes);
      } else {
        setError(te(result.error));
      }
    });
  }

  async function copy() {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setError(null);
      setMessage(t("copied"));
    } catch {
      setMessage(null);
      setError(t("copyFailed"));
    }
  }

  function close() {
    setCodes(null);
    setMessage(null);
    setError(null);
    setTimeout(() => triggerRef.current?.focus(), 0);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("heading")}</h2>
        </CardTitle>
        <CardDescription>{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Feedback message={message} error={error} />

        {codes ? (
          <section aria-labelledby="recovery-shown-title" className="flex flex-col gap-3" data-testid="recovery-shown">
            <h3 id="recovery-shown-title" ref={shownRef} tabIndex={-1} className="font-medium outline-none">
              {t("shownTitle")}
            </h3>
            <p className="text-sm">{t("once")}</p>
            <ul className="grid grid-cols-2 gap-2 font-mono text-sm" aria-label={t("list")} data-testid="new-recovery-codes">
              {codes.map((code) => (
                <li key={code} className="rounded-md border bg-muted px-2 py-1">
                  {code}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={copy}>
                {t("copy")}
              </Button>
              <Button type="button" onClick={close}>
                {t("close")}
              </Button>
            </div>
          </section>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t("warning")}</p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="recovery-password">{t("password")}</Label>
              <Input
                id="recovery-password"
                ref={triggerRef}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="max-w-sm"
              />
            </div>
            <Button type="submit" variant="secondary" disabled={pending} className="self-start">
              {pending ? t("working") : t("submit")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
