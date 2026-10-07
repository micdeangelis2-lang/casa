"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { runNowAction } from "../actions";

export function RunNowButton() {
  const t = useTranslations("notificationSettings");
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
              const r = await runNowAction();
              setMessage(t("ran", { evaluated: r.evaluated, occurrences: r.occurrences, notifications: r.notifications, emails: r.emails }));
            })
          }
        >
          {t("runNow")}
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
