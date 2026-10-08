import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  await requireOwner();
  const t = await getTranslations("settings");
  const tc = await getTranslations("documentCategories");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Link href="/impostazioni/sicurezza" className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
        <Card className="transition-colors hover:bg-accent/40">
          <CardHeader>
            <CardTitle>
              <h2>{t("securityTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("securityBody")}</CardDescription>
          </CardHeader>
        </Card>
      </Link>
      <Link href="/impostazioni/territori" className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
        <Card className="transition-colors hover:bg-accent/40">
          <CardHeader>
            <CardTitle>
              <h2>{t("territoriesTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("territoriesBody")}</CardDescription>
          </CardHeader>
        </Card>
      </Link>
      <Link href="/impostazioni/categorie" className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
        <Card className="transition-colors hover:bg-accent/40">
          <CardHeader>
            <CardTitle>
              <h2>{tc("cardTitle")}</h2>
            </CardTitle>
            <CardDescription>{tc("cardBody")}</CardDescription>
          </CardHeader>
        </Card>
      </Link>
      <Link href="/impostazioni/notifiche" className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
        <Card className="transition-colors hover:bg-accent/40">
          <CardHeader>
            <CardTitle>
              <h2>{t("notificationsTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("notificationsBody")}</CardDescription>
          </CardHeader>
        </Card>
      </Link>
      <Link href="/importa" className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
        <Card className="transition-colors hover:bg-accent/40">
          <CardHeader>
            <CardTitle>
              <h2>{t("importTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("importBody")}</CardDescription>
          </CardHeader>
        </Card>
      </Link>
      <Link href="/impostazioni/backup" className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
        <Card className="transition-colors hover:bg-accent/40">
          <CardHeader>
            <CardTitle>
              <h2>{t("backupTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("backupBody")}</CardDescription>
          </CardHeader>
        </Card>
      </Link>
      <Link href="/impostazioni/registro" className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
        <Card className="transition-colors hover:bg-accent/40">
          <CardHeader>
            <CardTitle>
              <h2>{t("auditTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("auditBody")}</CardDescription>
          </CardHeader>
        </Card>
      </Link>
    </div>
  );
}
