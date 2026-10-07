import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { ObligationItem } from "@/modules/taxes";

/** Situazione registrata di una voce, più «data superata» e «da chiedere al consulente» quando valgono. */
export function ObligationBadges({ item }: { item: Pick<ObligationItem, "state" | "overdue" | "askAdviser"> }) {
  const t = useTranslations("taxes");
  return (
    <>
      <Badge variant={item.state === "settled" ? "secondary" : "outline"}>{t(`state.${item.state}`)}</Badge>
      {item.overdue ? <Badge variant="destructive">{t("overdueBadge")}</Badge> : null}
      {item.askAdviser ? <Badge variant="outline">{t("askAdviserBadge")}</Badge> : null}
    </>
  );
}
