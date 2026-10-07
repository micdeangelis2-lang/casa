import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listActiveSessions, listPasskeys } from "@/platform/auth/account-security";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { describeUserAgent, maskIpAddress } from "@/shared/account-security";
import { PasskeysSection } from "./_components/passkeys-section";
import { PasswordSection } from "./_components/password-section";
import { RecoveryCodesSection } from "./_components/recovery-codes-section";
import { SessionsSection } from "./_components/sessions-section";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("securityPage");
  return { title: t("title") };
}

const dateTime = (d: Date | null) =>
  d ? d.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Rome" }) : "—";

export default async function SecurityPage() {
  const owner = await requireOwner();
  const t = await getTranslations("securityPage");
  const db = getDb();
  const [passkeys, sessions] = await Promise.all([listPasskeys(db, owner.userId), listActiveSessions(db, owner.userId)]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      <PasskeysSection
        passkeys={passkeys.map((p) => ({
          id: p.id,
          name: p.name,
          createdLabel: dateTime(p.createdAt),
          deviceType: p.deviceType,
          backedUp: p.backedUp,
        }))}
      />

      <SessionsSection
        sessions={sessions.map((s) => {
          const { browser, os } = describeUserAgent(s.userAgent);
          return {
            id: s.id,
            current: s.id === owner.sessionId,
            browser,
            os,
            createdLabel: dateTime(s.createdAt),
            lastUsedLabel: dateTime(s.updatedAt),
            maskedIp: maskIpAddress(s.ipAddress),
          };
        })}
      />

      <RecoveryCodesSection />
      <PasswordSection />
    </div>
  );
}
