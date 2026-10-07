import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { TAX_KINDS, listTaxTypes, territoryChoices } from "@/modules/taxes";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import type { FieldSpec } from "@/components/simple-form";
import { archiveTaxTypeAction, createTaxTypeAction, updateTaxTypeAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.types");
  return { title: t("title") };
}

export default async function TaxTypesPage({ searchParams }: PageProps<"/tributi/tipi">) {
  await requireOwner();
  const t = await getTranslations("taxes.types");
  const raw = (await searchParams).archiviati;
  const includeArchived = (Array.isArray(raw) ? raw[0] : raw) === "1";
  const db = getDb();
  const [types, scopes] = await Promise.all([listTaxTypes(db, includeArchived), territoryChoices(db)]);

  const fields: FieldSpec[] = [
    { kind: "text", name: "name", label: t("name"), maxLength: 120 },
    { kind: "select", name: "kind", label: t("kindLabel"), options: TAX_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) })) },
    { kind: "select", name: "territoryId", label: t("scope"), options: scopes.map((s) => ({ value: s.id, label: s.label })), emptyLabel: t("noScope") },
    { kind: "text", name: "source", label: t("source"), hint: t("sourceHint"), maxLength: 300 },
    { kind: "textarea", name: "notes", label: t("notes"), maxLength: 1000 },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href="/tributi" className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit print:hidden"}>
        <ArrowLeft aria-hidden /> {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <form method="get" className="flex flex-wrap items-center gap-3" role="search">
        <input id="archiviati" name="archiviati" type="checkbox" value="1" defaultChecked={includeArchived} className="size-4" />
        <Label htmlFor="archiviati">{t("showArchived")}</Label>
        <Button type="submit" variant="secondary" size="sm">
          {t("apply")}
        </Button>
      </form>

      {types.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-4" data-testid="tax-types">
        {types.map((type) => (
          <li key={type.id}>
            <Card>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{type.name}</span>
                  <Badge variant="secondary">{t(`kind.${type.kind}`)}</Badge>
                  {type.archived ? <Badge variant="outline">{t("archivedBadge")}</Badge> : null}
                  <ActionButton action={archiveTaxTypeAction.bind(null, type.id, !type.archived)} srLabel={type.name}>
                    {type.archived ? t("restore") : t("archive")}
                  </ActionButton>
                </div>
                <p className="text-muted-foreground">{[type.territoryLabel, type.source ? t("sourceLine", { source: type.source }) : null].filter(Boolean).join(" · ")}</p>
                {type.notes ? <p className="whitespace-pre-wrap">{type.notes}</p> : null}
                <details className="print:hidden">
                  <summary className="cursor-pointer text-muted-foreground">
                    {t("edit")}
                    <span className="sr-only">: {type.name}</span>
                  </summary>
                  <InlineForm
                    key={`${type.id}-${type.name}-${type.kind}-${type.territoryId}-${type.source}-${type.notes}`}
                    idPrefix={`type-${type.id}`}
                    title={t("save")}
                    fields={fields}
                    initial={{ name: type.name, kind: type.kind, territoryId: type.territoryId ?? "", source: type.source ?? "", notes: type.notes ?? "" }}
                    submitLabel={t("save")}
                    onSubmit={updateTaxTypeAction.bind(null, type.id)}
                  />
                </details>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <InlineForm idPrefix="type-new" title={t("addHeading")} fields={fields} initial={{ name: "", kind: "tax", territoryId: "", source: "", notes: "" }} submitLabel={t("add")} onSubmit={createTaxTypeAction} />
    </div>
  );
}
