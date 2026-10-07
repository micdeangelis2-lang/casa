import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/platform/db/client";
import { listAssetsWithoutCondominium, type CondominiumDetail } from "@/modules/condominium";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { addMemberAction, removeMemberAction } from "../actions";

export async function AnagraficaSection({ condo }: { condo: CondominiumDetail }) {
  const tf = await getTranslations("condominium.form");
  const td = await getTranslations("condominium.details");
  const free = await listAssetsWithoutCondominium(getDb());

  return (
    <>
      <Card>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{tf("address")}</dt>
            <dd>{condo.address ?? "—"}</dd>
            <dt className="text-muted-foreground">{tf("taxCode")}</dt>
            <dd>{condo.taxCode ?? "—"}</dd>
            <dt className="text-muted-foreground">{tf("administrator")}</dt>
            <dd>{condo.administratorName ?? "—"}</dd>
            {condo.notes ? (
              <>
                <dt className="text-muted-foreground">{tf("notes")}</dt>
                <dd className="whitespace-pre-wrap">{condo.notes}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("members")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {condo.members.length === 0 ? <p className="text-sm text-muted-foreground">{td("noMembers")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm" data-testid="condo-members">
            {condo.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/immobili/${m.assetId}`} className="font-medium underline underline-offset-2">
                  {m.assetName}
                </Link>
                {m.unitLabel ? <span className="text-muted-foreground">– {m.unitLabel}</span> : null}
                <ActionButton action={removeMemberAction.bind(null, condo.id, m.assetId)} srLabel={m.assetName}>
                  {td("memberRemove")}
                </ActionButton>
              </li>
            ))}
          </ul>
          {free.length === 0 ? (
            <p className="text-sm text-muted-foreground">{td("noFreeAssets")}</p>
          ) : (
            <InlineForm
              idPrefix="member"
              title={td("addMember")}
              fields={[
                { kind: "select", name: "assetId", label: td("memberAsset"), options: free.map((a) => ({ value: a.id, label: a.name })), emptyLabel: td("memberChoose") },
                { kind: "text", name: "unitLabel", label: td("memberLabel"), maxLength: 80 },
              ]}
              initial={{ assetId: "", unitLabel: "" }}
              submitLabel={td("memberAdd")}
              onSubmit={addMemberAction.bind(null, condo.id)}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
