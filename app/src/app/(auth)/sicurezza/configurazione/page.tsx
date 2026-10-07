import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { requireOwner, getOwnerSetup } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { passkey } from "@/platform/db/schema";
import { SecuritySetup } from "./security-setup";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.security");
  return { title: t("title") };
}

export default async function SecuritySetupPage() {
  const owner = await requireOwner({ allowIncompleteSetup: true });
  const setup = await getOwnerSetup(owner.userId);
  const passkeys = await getDb()
    .select({ id: passkey.id, name: passkey.name })
    .from(passkey)
    .where(eq(passkey.userId, owner.userId));

  return <SecuritySetup twoFactorEnabled={setup.twoFactorEnabled} passkeys={passkeys} />;
}
