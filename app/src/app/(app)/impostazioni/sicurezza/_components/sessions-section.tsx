"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollRegion } from "@/components/scroll-region";
import { revokeOtherSessionsAction, revokeSessionAction, type SecurityActionResult } from "../actions";
import { Feedback } from "./feedback";

export type SessionItem = {
  id: string;
  current: boolean;
  /** Browser e sistema ricavati dallo user agent; null = non riconosciuto. */
  browser: string | null;
  os: string | null;
  createdLabel: string;
  lastUsedLabel: string;
  /** Gia' mascherato dal server. */
  maskedIp: string | null;
};

export function SessionsSection({ sessions }: { sessions: SessionItem[] }) {
  const t = useTranslations("securityPage.sessions");
  const te = useTranslations("securityPage.errors");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const others = sessions.filter((s) => !s.current).length;

  const device = (s: SessionItem) => `${s.browser ?? t("unknownBrowser")} · ${s.os ?? t("unknownOs")}`;

  function run(work: () => Promise<SecurityActionResult>, done: (result: SecurityActionResult & { ok: true }) => string) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        setMessage(done(result));
        // La riga chiusa sparisce: il focus passa al titolo della sezione.
        headingRef.current?.focus();
      } else {
        setError(te(result.error));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={headingRef} tabIndex={-1} className="outline-none">
            {t("heading")}
          </h2>
        </CardTitle>
        <CardDescription>{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Feedback message={message} error={error} />

        <ScrollRegion label={t("list")}>
          <table className="w-full text-left text-sm" data-testid="session-table">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">{t("device")}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t("created")}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t("lastUsed")}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t("ip")}</th>
                <th scope="col" className="py-2 font-medium">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  className={`border-b align-top last:border-0 ${s.current ? "bg-accent/40" : ""}`}
                  data-testid="session-row"
                  data-current={s.current ? "true" : "false"}
                >
                  <td className="py-2 pr-4">
                    <span className="font-medium">{device(s)}</span>
                    {s.current ? (
                      <Badge className="ml-2" data-testid="current-session">
                        {t("current")}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{s.createdLabel}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{s.lastUsedLabel}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{s.maskedIp ?? t("unknownIp")}</td>
                  <td className="py-2">
                    {s.current ? null : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        aria-label={t("revokeFor", { device: device(s) })}
                        onClick={() => run(() => revokeSessionAction(s.id), () => t("revoked"))}
                      >
                        {t("revoke")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>

        <div className="flex flex-col items-start gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={pending || others === 0}
            onClick={() => run(() => revokeOtherSessionsAction(), (result) => t("revokedOthers", { count: result.revoked ?? 0 }))}
          >
            {t("revokeOthers")}
          </Button>
          {others === 0 ? <p className="text-sm text-muted-foreground">{t("noOthers")}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
