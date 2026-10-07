"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Stampa la pagina (il resto della pagina nasconde i comandi con `print:hidden`). */
export function PrintButton() {
  const t = useTranslations("common");
  return (
    <Button type="button" variant="outline" className="print:hidden" onClick={() => window.print()}>
      <Printer aria-hidden /> {t("print")}
    </Button>
  );
}
