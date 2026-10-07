import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { getParty } from "@/modules/directory";
import { listDocumentCategories } from "@/modules/documents";
import { getMatterDetail } from "@/modules/matters";
import { CONFIDENTIALITY_LEVELS, RECIPIENT_TYPES, candidateDocuments, type ConfidentialityLevel } from "@/modules/sharing";
import { isUuid } from "@/lib/ids";
import { PackageBuilder } from "../_components/package-builder";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sharing.builder");
  return { title: t("title") };
}

const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(isUuid);

export default async function NewPackagePage({ searchParams }: PageProps<"/condivisione/nuovo">) {
  await requireOwner();
  const t = await getTranslations("sharing");
  const tb = await getTranslations("sharing.builder");
  const params = await searchParams;
  const db = getDb();
  const [assets, categories] = await Promise.all([listAssets(db), listDocumentCategories(db)]);

  const capParam = Array.isArray(params.livello) ? params.livello[0] : params.livello;
  const cap = (CONFIDENTIALITY_LEVELS as readonly string[]).includes(capParam ?? "") ? (capParam as ConfidentialityLevel) : "ordinary";
  const assetIds = many(params.immobile);
  const categoryIds = many(params.categoria);
  const filtered = params.mostra === "1";
  // Preimpostazioni dalla scheda per il notaio: tipo di destinatario e, se scelto, il nome dalla rubrica.
  const recipientParam = Array.isArray(params.destinatario) ? params.destinatario[0] : params.destinatario;
  const initialRecipientType = (RECIPIENT_TYPES as readonly string[]).includes(recipientParam ?? "") ? recipientParam : undefined;
  const contactParam = Array.isArray(params.contatto) ? params.contatto[0] : params.contatto;
  const initialRecipientName = contactParam && isUuid(contactParam) ? ((await getParty(db, contactParam))?.displayName ?? "") : "";
  // Dalla scheda di una pratica: si propongono solo i documenti collegati a quella pratica.
  const matterParam = Array.isArray(params.pratica) ? params.pratica[0] : params.pratica;
  const matterId = matterParam && isUuid(matterParam) ? matterParam : undefined;
  const matterDocumentIds = matterId ? new Set((await getMatterDetail(db, matterId))?.documents.map((d) => d.id) ?? []) : null;
  const found = filtered ? await candidateDocuments(db, { assetIds, categoryIds }, cap) : [];
  const candidates = matterDocumentIds ? found.filter((c) => matterDocumentIds.has(c.id)) : found;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">{tb("title")}</h1>

      <form method="get" className="flex flex-col gap-4" aria-label={tb("step1")}>
        <h2 className="text-lg font-medium">{tb("step1")}</h2>
        <div className="flex max-w-sm flex-col gap-2">
          <Label htmlFor="livello">{tb("cap")}</Label>
          <NativeSelect id="livello" name="livello" defaultValue={cap}>
            {CONFIDENTIALITY_LEVELS.map((c) => (
              <option key={c} value={c}>
                {t(`confidentiality.${c}`)}
              </option>
            ))}
          </NativeSelect>
          <p className="text-sm text-muted-foreground">{tb("capHint")}</p>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{tb("assets")}</legend>
          <p className="text-sm text-muted-foreground">{tb("assetsHint")}</p>
          <ul className="flex flex-col gap-1">
            {assets.map((a) => (
              <li key={a.id} className="flex items-center gap-3">
                <input id={`a-${a.id}`} type="checkbox" name="immobile" value={a.id} defaultChecked={assetIds.includes(a.id)} className="size-6" />
                <Label htmlFor={`a-${a.id}`}>{a.name}</Label>
              </li>
            ))}
          </ul>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{tb("categories")}</legend>
          <p className="text-sm text-muted-foreground">{tb("categoriesHint")}</p>
          <ul className="flex flex-col gap-1">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-3">
                <input id={`c-${c.id}`} type="checkbox" name="categoria" value={c.id} defaultChecked={categoryIds.includes(c.id)} className="size-6" />
                <Label htmlFor={`c-${c.id}`}>{c.name}</Label>
              </li>
            ))}
          </ul>
        </fieldset>
        <input type="hidden" name="mostra" value="1" />
        {matterId ? <input type="hidden" name="pratica" value={matterId} /> : null}
        {initialRecipientType ? <input type="hidden" name="destinatario" value={initialRecipientType} /> : null}
        <div>
          <Button type="submit" variant="secondary">
            {tb("filter")}
          </Button>
        </div>
      </form>

      {filtered ? (
        <PackageBuilder
          key={`${cap}-${assetIds.join(",")}-${categoryIds.join(",")}`}
          cap={cap}
          initialRecipientType={initialRecipientType}
          initialRecipientName={initialRecipientName}
          recipientTypes={[...RECIPIENT_TYPES]}
          candidates={candidates.map((c) => ({ id: c.id, title: c.title, categoryName: c.categoryName, confidentiality: c.confidentiality, exceedsCap: c.exceedsCap, assetNames: c.assetNames, sizeBytes: c.sizeBytes }))}
        />
      ) : null}
    </div>
  );
}
