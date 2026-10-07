"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveDocumentAction } from "../actions";

export function ArchiveButton({ documentId, archived }: { documentId: string; archived: boolean }) {
  const t = useTranslations("documents.detail");
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="ghost" disabled={pending} onClick={() => startTransition(() => archiveDocumentAction(documentId, !archived))}>
      {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
      {archived ? t("restore") : t("archive")}
    </Button>
  );
}
