import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ScrollRegion } from "@/components/scroll-region";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listPackages } from "@/modules/sharing";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sharing");
  return { title: t("title") };
}

export default async function SharingPage() {
  await requireOwner();
  const t = await getTranslations("sharing");
  const packages = await listPackages(getDb());

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Link href="/condivisione/nuovo" className={buttonVariants()}>
          <Plus aria-hidden /> {t("add")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      {packages.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Share2 className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
        </div>
      ) : (
        <ScrollRegion label={t("title")}>
          <table className="w-full text-left text-sm" data-testid="package-list">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{t("list.date")}</th>
                <th className="py-2 pr-4 font-medium">{t("list.recipient")}</th>
                <th className="py-2 pr-4 font-medium">{t("list.cap")}</th>
                <th className="py-2 pr-4 font-medium">{t("list.files")}</th>
                <th className="py-2 pr-4 font-medium">{t("list.downloads")}</th>
                <th className="py-2 pr-4 font-medium">{t("list.state")}</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">{t("list.open")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-4">{p.createdAt.toLocaleDateString("it-IT")}</td>
                  <td className="py-2 pr-4">
                    <span className="font-medium">{p.recipientName}</span>
                    <br />
                    <span className="text-muted-foreground">{t(`recipient.${p.recipientType}`)}</span>
                  </td>
                  <td className="py-2 pr-4">{t(`confidentiality.${p.confidentialityCap}`)}</td>
                  <td className="py-2 pr-4">{p.fileCount}</td>
                  <td className="py-2 pr-4">{p.downloads}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={p.revoked ? "destructive" : "secondary"}>{p.revoked ? t("list.revoked") : t("list.active")}</Badge>
                  </td>
                  <td className="py-2">
                    <Link href={`/condivisione/${p.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      {t("list.open")}
                      <span className="sr-only">: {p.recipientName}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </div>
  );
}
