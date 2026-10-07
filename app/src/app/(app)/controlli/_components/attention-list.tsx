import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { Finding } from "@/modules/attention";
import { formatDate, formatEuro } from "@/lib/format";

/** Il testo di un risultato: la data e gli importi arrivano grezzi dal modulo e si formattano qui. */
function useFindingText() {
  const t = useTranslations("attention.kinds");
  return (f: Finding): string => {
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(f.params)) {
      if (key === "cents") params.amount = formatEuro(Number(value));
      else if (key === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) params.date = formatDate(value);
      else params[key] = value;
    }
    return t(f.kind as never, params as never);
  };
}

/** Elenco dei risultati di «Da controllare» (la pagina completa e il riquadro della panoramica). */
export function AttentionList({ findings, testId = "attention-list" }: { findings: Finding[]; testId?: string }) {
  const text = useFindingText();
  const ts = useTranslations("attention.severity");
  const ta = useTranslations("attention.areas");
  return (
    <ul className="flex flex-col divide-y" data-testid={testId}>
      {findings.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-kind={f.kind}>
          <Badge variant={f.severity === "high" ? "destructive" : "outline"}>{ts(f.severity)}</Badge>
          <span className="text-muted-foreground">{ta(f.area)}</span>
          <Link href={f.href} className="underline underline-offset-2">
            {text(f)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
