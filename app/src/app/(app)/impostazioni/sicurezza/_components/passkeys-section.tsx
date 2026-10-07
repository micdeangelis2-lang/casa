"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasskeyAddForm } from "@/components/passkey-add-form";
import { ScrollRegion } from "@/components/scroll-region";
import { removePasskeyAction, renamePasskeyAction, type SecurityActionResult } from "../actions";
import { Feedback } from "./feedback";

export type PasskeyItem = {
  id: string;
  name: string | null;
  /** Data gia' formattata dal server. */
  createdLabel: string;
  deviceType: string;
  backedUp: boolean;
};

export function PasskeysSection({ passkeys }: { passkeys: PasskeyItem[] }) {
  const t = useTranslations("securityPage");
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const lastOne = passkeys.length <= 1;

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  const label = (p: PasskeyItem) => p.name || t("passkeys.unnamed");

  function run(work: () => Promise<SecurityActionResult>, done: string, after: () => void) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        setMessage(done);
        after();
      } else {
        setError(t(`errors.${result.error}`));
      }
    });
  }

  function submitRename(event: FormEvent<HTMLFormElement>, item: PasskeyItem) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    run(
      () => renamePasskeyAction(item.id, name),
      t("passkeys.renamed"),
      () => {
        setRenaming(null);
        // Il focus torna al pulsante che ha aperto la modifica.
        setTimeout(() => document.getElementById(`rename-${item.id}`)?.focus(), 0);
      },
    );
  }

  function remove(item: PasskeyItem) {
    run(
      () => removePasskeyAction(item.id),
      t("passkeys.removed"),
      () => {
        setConfirming(null);
        // La riga sparisce: il focus passa al titolo della sezione.
        headingRef.current?.focus();
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={headingRef} tabIndex={-1} className="outline-none">
            {t("passkeys.heading")}
          </h2>
        </CardTitle>
        <CardDescription>{t("passkeys.intro")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <Feedback message={message} error={error} />

        <ScrollRegion label={t("passkeys.list")}>
          <table className="relative w-full text-left text-sm" data-testid="passkey-table">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">{t("passkeys.name")}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t("passkeys.created")}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t("passkeys.type")}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t("passkeys.synced")}</th>
                <th scope="col" className="py-2 font-medium">{t("passkeys.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {passkeys.map((p) => (
                <tr key={p.id} className="border-b align-top last:border-0" data-testid="passkey-row">
                  <td className="py-2 pr-4">
                    {renaming === p.id ? (
                      <form onSubmit={(event) => submitRename(event, p)} className="flex flex-wrap items-end gap-2">
                        <div className="flex flex-col gap-1">
                          <Label htmlFor={`rename-input-${p.id}`} className="sr-only">
                            {t("passkeys.renameLabel", { name: label(p) })}
                          </Label>
                          <Input
                            id={`rename-input-${p.id}`}
                            ref={renameInputRef}
                            name="name"
                            defaultValue={p.name ?? ""}
                            maxLength={60}
                            required
                          />
                        </div>
                        <Button type="submit" size="sm" disabled={pending}>
                          {t("passkeys.save")}
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setRenaming(null)}>
                          {t("passkeys.cancel")}
                        </Button>
                      </form>
                    ) : (
                      <span className="font-medium">{label(p)}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{p.createdLabel}</td>
                  <td className="py-2 pr-4">{p.deviceType === "multiDevice" ? t("passkeys.typeMulti") : t("passkeys.typeSingle")}</td>
                  <td className="py-2 pr-4">
                    <Badge variant="secondary">{p.backedUp ? t("passkeys.yes") : t("passkeys.no")}</Badge>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        id={`rename-${p.id}`}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          setConfirming(null);
                          setRenaming(p.id);
                        }}
                      >
                        {t("passkeys.rename")}
                        <span className="sr-only"> {label(p)}</span>
                      </Button>
                      {confirming === p.id ? (
                        <>
                          <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => remove(p)}>
                            {t("passkeys.removeConfirm")}
                            <span className="sr-only"> {label(p)}</span>
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(null)}>
                            {t("passkeys.cancel")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending || lastOne}
                          onClick={() => {
                            setRenaming(null);
                            setConfirming(p.id);
                          }}
                        >
                          {t("passkeys.remove")}
                          <span className="sr-only"> {label(p)}</span>
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
        {lastOne ? <p className="text-sm text-muted-foreground">{t("passkeys.lastHint")}</p> : null}

        <section aria-labelledby="passkey-add-title" className="flex flex-col gap-3">
          <h3 id="passkey-add-title" className="font-medium">
            {t("passkeys.addHeading")}
          </h3>
          <PasskeyAddForm idPrefix="security-passkey" />
        </section>
      </CardContent>
    </Card>
  );
}
