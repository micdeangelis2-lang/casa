import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { EngagementItem } from "@/modules/engagements";
import { formatDate, formatEuro } from "@/lib/format";

/**
 * Elenco di sola lettura degli incarichi (con gli elaborati) per le schede da consegnare: il fascicolo della pratica e la scheda
 * per il tecnico. Compenso e stato sono quelli scritti dal proprietario.
 */
export async function EngagementSummary({ items, testId }: { items: EngagementItem[]; testId: string }) {
  const t = await getTranslations("engagements");
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t("summary.none")}</p>;
  return (
    <ul className="flex flex-col gap-3 text-sm" data-testid={testId}>
      {items.map((e) => (
        <li key={e.id} className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{t("summary.line", { party: e.partyName, subject: e.subject })}</span>
            <Badge variant="outline">{t(`status.${e.status}`)}</Badge>
          </span>
          <span className="text-muted-foreground">
            {[t("engagedOn", { date: formatDate(e.engagedOn) }), e.declaredFeeCents === null ? t("noFee") : t("fee", { amount: formatEuro(e.declaredFeeCents) })].join(" · ")}
          </span>
          {e.deliverables.length > 0 ? (
            <ul className="list-disc pl-5">
              {e.deliverables.map((d) => (
                <li key={d.id}>
                  {t(`direction.${d.direction}`)}: {t("deliverableLine", { kind: d.kindLabel, date: formatDate(d.occurredOn) })}
                  {d.documentId && d.documentTitle ? (
                    <>
                      {" — "}
                      <Link href={`/documenti/${d.documentId}`} className="underline underline-offset-2">
                        {d.documentTitle}
                      </Link>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
