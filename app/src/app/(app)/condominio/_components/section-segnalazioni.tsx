import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/platform/db/client";
import { listMatters } from "@/modules/matters";
import { CLAIM_KINDS, type CondominiumDetail } from "@/modules/condominium";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { formatDate } from "@/lib/format";
import { createClaimAction, setClaimStatusAction } from "../actions";

export async function SegnalazioniSection({ condo }: { condo: CondominiumDetail }) {
  const t = await getTranslations("condominium.claims");
  const matters = (await listMatters(getDb(), { includeClosed: true })).map((m) => ({ value: m.id, label: m.title }));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {condo.claims.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="claim-list">
            {condo.claims.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t(`kind.${c.kind as (typeof CLAIM_KINDS)[number]}`)}</Badge>
                  <span className="font-medium">{c.title}</span>
                  <Badge variant={c.status === "open" ? "secondary" : "outline"}>{t(`status.${c.status}`)}</Badge>
                  <span className="text-muted-foreground">{c.closedOn ? t("closedOn", { date: formatDate(c.closedOn) }) : t("openedOn", { date: formatDate(c.openedOn) })}</span>
                </div>
                {c.description ? <p className="whitespace-pre-wrap">{c.description}</p> : null}
                {c.matterId && c.matterTitle ? (
                  <Link href={`/pratiche/${c.matterId}`} className="underline underline-offset-2">
                    {c.matterTitle}
                  </Link>
                ) : null}
                <div>
                  <ActionButton
                    action={setClaimStatusAction.bind(null, condo.id, { id: c.id, kind: c.kind, title: c.title, description: c.description ?? "", matterId: c.matterId ?? "" }, c.status === "open" ? "closed" : "open")}
                    srLabel={c.title}
                  >
                    {c.status === "open" ? t("close") : t("reopen")}
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <InlineForm
        idPrefix="claim"
        title={t("addHeading")}
        fields={[
          { kind: "select", name: "kind", label: t("kindLabel"), options: CLAIM_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) })) },
          { kind: "text", name: "title", label: t("title"), maxLength: 200 },
          { kind: "textarea", name: "description", label: t("description"), maxLength: 2000 },
          { kind: "select", name: "matterId", label: t("matter"), options: matters, emptyLabel: t("noMatter") },
        ]}
        initial={{ kind: "claim", title: "", description: "", matterId: "" }}
        submitLabel={t("add")}
        onSubmit={createClaimAction.bind(null, condo.id)}
      />
    </div>
  );
}
