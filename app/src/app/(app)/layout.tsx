import { cookies } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Bell, Search } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { countUnreadNotifications } from "@/modules/deadlines";
import { AppSidebar } from "./_components/app-sidebar";
import { UserMenu } from "./_components/user-menu";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Controllo ottimistico: i layout non si rieseguono a ogni navigazione.
  // Ogni pagina e ogni azione chiamano comunque requireOwner() per conto proprio.
  const owner = await requireOwner();
  const tCommon = await getTranslations("common");
  const tNotifications = await getTranslations("notifications");
  const tSearch = await getTranslations("search");
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const unread = await countUnreadNotifications(getDb());
  return (
    <SidebarProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        {tCommon("skipToContent")}
      </a>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4 print:hidden">
          <SidebarTrigger />
          <form action="/cerca" method="get" role="search" aria-label={tSearch("quickLabel")} className="ml-auto flex max-w-xs flex-1 items-center gap-1">
            <label htmlFor="global-search" className="sr-only">
              {tSearch("quickLabel")}
            </label>
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="global-search" name="q" type="search" maxLength={100} placeholder={tSearch("placeholder")} className="pl-8" data-testid="global-search" />
            </div>
          </form>
          <Link
            href="/avvisi"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label={`${tNotifications("bell")}: ${tNotifications("unread", { count: unread })}`}
            data-testid="notifications-link"
          >
            <Bell className="size-4" aria-hidden />
            {unread > 0 ? <span className="rounded-full bg-destructive px-1.5 text-xs text-white">{unread}</span> : null}
          </Link>
          <ThemeToggle theme={theme} />
          <UserMenu email={owner.email} />
        </header>
        <main id="main" className="flex-1 p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
