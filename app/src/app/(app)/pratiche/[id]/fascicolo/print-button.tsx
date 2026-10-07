"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Apre la stampa del browser (anche per salvare in PDF). */
export function PrintButton({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      {icon} {label}
    </Button>
  );
}
