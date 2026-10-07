"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveAssetAction } from "../actions";

export function ArchiveButton({ assetId, archived }: { assetId: string; archived: boolean }) {
  const t = useTranslations("assets.detail");
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(() => archiveAssetAction(assetId, !archived))}
    >
      {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
      {archived ? t("restore") : t("archive")}
    </Button>
  );
}
