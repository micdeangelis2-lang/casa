"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { revokePackageAction } from "../actions";

export function RevokeButton({ packageId, label }: { packageId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="ghost" disabled={pending} onClick={() => startTransition(() => revokePackageAction(packageId))}>
      {label}
    </Button>
  );
}
