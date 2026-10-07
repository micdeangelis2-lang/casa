import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listDocumentCategoryUsage, SUGGESTED_CATEGORY_NAME } from "@/modules/documents";
import { ActionButton } from "@/components/action-button";
import { EditInline } from "@/components/edit-inline";
import { InlineForm } from "@/components/inline-form";
import { addCategoryAction, addSuggestedCategoryAction, moveCategoryAction, removeCategoryAction, renameCategoryAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documentCategories");
  return { title: t("title") };
}

export default async function DocumentCategoriesPage() {
  await requireOwner();
  const t = await getTranslations("documentCategories");
  const te = await getTranslations("editUi");
  const categories = await listDocumentCategoryUsage(getDb());
  const hasSuggested = categories.some((c) => c.name.trim().toLocaleLowerCase("it") === SUGGESTED_CATEGORY_NAME.toLocaleLowerCase("it"));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("listHeading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <ol className="flex flex-col gap-3" data-testid="document-categories">
            {categories.map((c, index) => (
              <li key={c.id} className="flex flex-col gap-1 rounded-lg border p-3" data-testid="document-category">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <Badge variant="outline">{t("documents", { count: c.documents })}</Badge>
                  {c.protected ? <Badge variant="secondary">{t("protected")}</Badge> : null}
                  <ActionButton action={moveCategoryAction.bind(null, c.id, "up")} srLabel={c.name} disabled={index === 0}>
                    {t("up")}
                  </ActionButton>
                  <ActionButton action={moveCategoryAction.bind(null, c.id, "down")} srLabel={c.name} disabled={index === categories.length - 1}>
                    {t("down")}
                  </ActionButton>
                  {c.removable ? (
                    <ActionButton action={removeCategoryAction.bind(null, c.id)} srLabel={c.name}>
                      {t("remove")}
                    </ActionButton>
                  ) : null}
                </div>
                {!c.removable ? (
                  <p className="text-muted-foreground">
                    {c.protected ? t("whyProtected") : c.documents > 0 ? t("whyDocuments") : c.children > 0 ? t("whyChildren") : t("whyReferenced")}
                  </p>
                ) : null}
                <EditInline
                  idPrefix={`category-edit-${c.id}`}
                  title={`${te("editing")}: ${c.name}`}
                  openLabel={t("rename")}
                  cancelLabel={te("cancel")}
                  srLabel={c.name}
                  submitLabel={te("save")}
                  fields={[{ kind: "text", name: "name", label: t("nameLabel"), maxLength: 120 }]}
                  initial={{ name: c.name }}
                  onSubmit={renameCategoryAction.bind(null, c.id)}
                />
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {!hasSuggested ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("suggestedHeading")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-2 text-sm">
            <p className="text-muted-foreground">{t("suggestedBody")}</p>
            <ActionButton action={addSuggestedCategoryAction} variant="secondary" data-testid="category-suggested">
              {t("suggestedButton", { name: SUGGESTED_CATEGORY_NAME })}
            </ActionButton>
          </CardContent>
        </Card>
      ) : null}

      <InlineForm
        idPrefix="category-new"
        title={t("add")}
        fields={[{ kind: "text", name: "name", label: t("nameLabel"), hint: t("nameHint"), maxLength: 120 }]}
        initial={{ name: "" }}
        submitLabel={t("addButton")}
        onSubmit={addCategoryAction}
      />
    </div>
  );
}
