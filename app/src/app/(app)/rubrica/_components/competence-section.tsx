import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/platform/db/client";
import { COMPETENCE_KINDS, listCompetences } from "@/modules/directory";
import { listDocumentOptions } from "@/modules/documents";
import { ActionButton } from "@/components/action-button";
import { EditInline } from "@/components/edit-inline";
import { InlineForm } from "@/components/inline-form";
import type { FieldSpec } from "@/components/simple-form";
import { formatDate } from "@/lib/format";
import { addCompetenceAction, removeCompetenceAction, updateCompetenceAction } from "../competence-actions";

/** Competenze di un contatto (iscrizione a un albo, abilitazione, polizza...): dati scritti da te, che l'app non verifica. */
export async function CompetenceSection({ partyId }: { partyId: string }) {
  const t = await getTranslations("directory.competence");
  const te = await getTranslations("editUi");
  const db = getDb();
  const [items, documents] = await Promise.all([listCompetences(db, partyId), listDocumentOptions(db)]);
  const titles = new Map(documents.map((d) => [d.value, d.label]));
  const fields = (documentOptions: { value: string; label: string }[]): FieldSpec[] => [
    { kind: "select", name: "kind", label: t("kindLabel"), options: COMPETENCE_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) })), emptyLabel: t("choose") },
    { kind: "text", name: "label", label: t("labelLabel"), maxLength: 200 },
    { kind: "text", name: "reference", label: t("referenceLabel"), maxLength: 120 },
    { kind: "text", name: "issuer", label: t("issuerLabel"), maxLength: 160 },
    { kind: "date", name: "validFrom", label: t("validFromLabel") },
    { kind: "date", name: "validUntil", label: t("validUntilLabel") },
    { kind: "select", name: "documentId", label: t("documentLabel"), options: documentOptions, emptyLabel: t("none") },
    { kind: "text", name: "note", label: t("noteLabel"), maxLength: 500 },
  ];

  return (
    <Card className="mt-6" data-testid="competences">
      <CardHeader>
        <CardTitle>
          <h2>{t("title")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p className="text-muted-foreground">{t("intro")}</p>
        {items.length === 0 ? <p data-testid="competences-empty">{t("empty")}</p> : null}
        <ul className="flex flex-col gap-3" data-testid="competence-list">
          {items.map((c) => (
            <li key={c.id} className="flex flex-col gap-1">
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{t(`kind.${c.kind}`)}</Badge>
                <span className="font-medium">{c.label}</span>
                {c.state === "expired" ? <Badge variant="destructive">{t("expired")}</Badge> : c.state === "expiring" ? <Badge variant="secondary">{t("expiring")}</Badge> : null}
                <ActionButton action={removeCompetenceAction.bind(null, partyId, c.id)} srLabel={c.label}>
                  {t("remove")}
                </ActionButton>
              </p>
              <p className="text-muted-foreground">
                {[c.reference ? t("reference", { reference: c.reference }) : null, c.issuer ? t("issuer", { issuer: c.issuer }) : null, c.validFrom ? t("validFrom", { date: formatDate(c.validFrom) }) : null, c.validUntil ? t("validUntil", { date: formatDate(c.validUntil) }) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {c.documentId && titles.get(c.documentId) ? (
                <Link href={`/documenti/${c.documentId}`} className="w-fit underline underline-offset-2">
                  {titles.get(c.documentId)}
                </Link>
              ) : null}
              {c.note ? <p className="whitespace-pre-wrap">{c.note}</p> : null}
              <EditInline
                idPrefix={`competence-edit-${c.id}`}
                title={`${te("editing")}: ${c.label}`}
                openLabel={te("edit")}
                cancelLabel={te("cancel")}
                srLabel={c.label}
                submitLabel={te("save")}
                fields={fields(c.documentId && !titles.has(c.documentId) ? [{ value: c.documentId, label: te("linkedDocument") }, ...documents] : documents)}
                initial={{ kind: c.kind, label: c.label, reference: c.reference ?? "", issuer: c.issuer ?? "", validFrom: c.validFrom ?? "", validUntil: c.validUntil ?? "", documentId: c.documentId ?? "", note: c.note ?? "" }}
                onSubmit={updateCompetenceAction.bind(null, partyId, c.id)}
              />
            </li>
          ))}
        </ul>
        <InlineForm
          idPrefix="competence"
          title={t("add")}
          fields={fields(documents)}
          initial={{ kind: "", label: "", reference: "", issuer: "", validFrom: "", validUntil: "", documentId: "", note: "" }}
          submitLabel={t("addButton")}
          onSubmit={addCompetenceAction.bind(null, partyId)}
        />
      </CardContent>
    </Card>
  );
}
