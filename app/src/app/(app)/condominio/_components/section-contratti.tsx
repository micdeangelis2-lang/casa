import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/platform/db/client";
import { listParties } from "@/modules/directory";
import { listDocumentOptions } from "@/modules/documents";
import { CONTRACT_KINDS, todayInItaly, type CondominiumDetail } from "@/modules/condominium";
import { addDays } from "@/shared/dates";
import { InlineForm } from "@/components/inline-form";
import { formatDate } from "@/lib/format";
import { createContractAction } from "../actions";

export async function ContrattiSection({ condo }: { condo: CondominiumDetail }) {
  const t = await getTranslations("condominium.contracts");
  const db = getDb();
  const [parties, documents] = await Promise.all([listParties(db), listDocumentOptions(db)]);
  const today = todayInItaly();
  const soon = addDays(today, 60);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {condo.contracts.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="contract-list">
            {condo.contracts.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t(`kind.${c.kind}`)}</Badge>
                  <span className="font-medium">{c.title}</span>
                  {c.validTo && c.validTo < today ? <Badge variant="destructive">{t("expired")}</Badge> : null}
                  {c.validTo && c.validTo >= today && c.validTo <= soon ? <Badge variant="secondary">{t("expiring")}</Badge> : null}
                </div>
                <p className="text-muted-foreground">{[c.counterpartyName, c.validFrom ? t("validFromLine", { date: formatDate(c.validFrom) }) : null, c.validTo ? t("validUntil", { date: formatDate(c.validTo) }) : null, c.note].filter(Boolean).join(" · ")}</p>
                {c.documentId && c.documentTitle ? (
                  <Link href={`/documenti/${c.documentId}`} className="underline underline-offset-2">
                    {c.documentTitle}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <InlineForm
        idPrefix="contract"
        title={t("addHeading")}
        fields={[
          { kind: "select", name: "kind", label: t("kindLabel"), options: CONTRACT_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) })) },
          { kind: "text", name: "title", label: t("title"), maxLength: 200 },
          { kind: "select", name: "counterpartyPartyId", label: t("counterparty"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: t("noCounterparty") },
          { kind: "date", name: "validFrom", label: t("validFrom") },
          { kind: "date", name: "validTo", label: t("validTo") },
          { kind: "select", name: "documentId", label: t("document"), options: documents, emptyLabel: "—" },
          { kind: "text", name: "note", label: t("note"), maxLength: 500 },
        ]}
        initial={{ kind: "contract", title: "", counterpartyPartyId: "", validFrom: "", validTo: "", documentId: "", note: "" }}
        submitLabel={t("add")}
        onSubmit={createContractAction.bind(null, condo.id)}
      />
    </div>
  );
}
