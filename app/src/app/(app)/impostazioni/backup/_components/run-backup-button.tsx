"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { DatabaseBackup } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { runBackupAction, type RunBackupResult } from "../actions";

export function RunBackupButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations("backup.run");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RunBackupResult | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          type="button"
          disabled={disabled || pending}
          onClick={() => {
            setResult(null);
            startTransition(async () => setResult(await runBackupAction()));
          }}
        >
          <DatabaseBackup aria-hidden /> {pending ? t("running") : t("button")}
        </Button>
      </div>
      <div aria-live="polite">
        {result ? (
          <Alert variant={result.ok && !result.warning ? "default" : "destructive"}>
            <AlertDescription>
              {!result.ok ? t("failed", { message: result.message }) : result.warning ? t("doneWarning", { message: result.warning }) : t("done")}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
