import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { Outcome } from "@/modules/rules/client";

/** Gli esiti di una versione di regola, in sola lettura. */
export function OutcomeList({ outcomes, categories }: { outcomes: Outcome[]; categories?: Map<string, string> }) {
  const t = useTranslations("rules.detail");
  const td = useTranslations("deadlines");
  const tcalc = useTranslations("calc");
  const tc = useTranslations("rules.outcomeExtra");
  return (
    <ul className="flex flex-col gap-2">
      {outcomes.map((o) => (
        <li key={o.key} className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{o.type === "checklist" ? t("checklistItem") : o.type === "notice" ? t("notice") : t("deadlineItem")}</Badge>
            <span className="font-medium">{o.title}</span>
            <span className="font-mono text-xs text-muted-foreground">{o.key}</span>
          </span>
          {o.type === "checklist" ? (
            <span className="text-muted-foreground">
              {t("category")}: {categories?.get(o.dossierCategory) ?? o.dossierCategory}
              {o.expectedDocumentCategory ? ` · ${t("expected")}: ${categories?.get(o.expectedDocumentCategory) ?? o.expectedDocumentCategory}` : ""}
              {o.note ? ` · ${o.note}` : ""}
            </span>
          ) : o.type === "notice" ? (
            <span className="text-muted-foreground">{o.message}</span>
          ) : (
            <span className="text-muted-foreground">
              {td(`category.${o.category}`)} · {td(`priority.${o.priority}`)} · {o.calc.type === "manual" ? tc("manual") : tcalc(`types.${o.calc.type}`)}
              {o.shiftToBusinessDay ? ` · ${tc("shift")}` : ""}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
