import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getNotificationSettings, mailFromEnv } from "@/modules/deadlines";
import { SimpleForm } from "@/components/simple-form";
import { RunNowButton } from "./_components/run-now";
import { saveSettingsAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notificationSettings");
  return { title: t("title") };
}

export default async function NotificationSettingsPage() {
  await requireOwner();
  const t = await getTranslations("notificationSettings");
  const settings = await getNotificationSettings(getDb());
  const configured = mailFromEnv().configured;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("provider")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {configured ? <p className="text-sm">{t("providerOk")}</p> : (
            <Alert>
              <AlertDescription>{t("providerMissing")}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <SimpleForm
        title={t("title")}
        intro={t("intro")}
        sections={[
          {
            fields: [
              { kind: "checkbox", name: "emailEnabled", label: t("enabled") },
              { kind: "text", name: "emailAddress", label: t("address"), hint: t("addressHint"), inputMode: "email", maxLength: 200 },
            ],
          },
        ]}
        initial={{ emailEnabled: settings.emailEnabled, emailAddress: settings.emailAddress }}
        submitLabel={t("save")}
        onSubmit={saveSettingsAction}
        cancelHref="/impostazioni"
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("daily")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("dailyBody")}</p>
          <RunNowButton />
        </CardContent>
      </Card>
    </div>
  );
}
