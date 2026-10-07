"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function UserMenu({ email }: { email: string }) {
  const t = useTranslations("auth.userMenu");
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.replace("/accesso");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-muted-foreground sm:inline" data-testid="owner-email">
        {email}
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={signOut}>
        <LogOut aria-hidden />
        {t("signOut")}
      </Button>
    </div>
  );
}
