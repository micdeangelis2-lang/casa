"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markReadAction } from "../../scadenze/actions";

export function MarkReadButton({ id, label, srLabel }: { id: string | null; label: string; srLabel?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => startTransition(() => markReadAction(id))}>
      {label}
      {srLabel ? <span className="sr-only">: {srLabel}</span> : null}
    </Button>
  );
}
