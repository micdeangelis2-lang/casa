"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { navGroups } from "./nav-items";

export function AppSidebar() {
  const pathname = usePathname();
  const tApp = useTranslations("app");
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tDisclaimer = useTranslations("disclaimer");

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <p className="px-2 py-1.5 text-sm font-semibold tracking-tight">{tApp("name")}</p>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.key}>
            <SidebarGroupLabel>{tNav(`groups.${group.key}`)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const label = tNav(`items.${item.key}`);
                  const Icon = item.icon;
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.key}>
                      {item.available ? (
                        <SidebarMenuButton asChild isActive={active}>
                          <Link href={item.href} aria-current={active ? "page" : undefined}>
                            <Icon aria-hidden />
                            <span>{label}</span>
                          </Link>
                        </SidebarMenuButton>
                      ) : (
                        <SidebarMenuButton disabled aria-disabled className="opacity-60">
                          <Icon aria-hidden />
                          <span>{label}</span>
                          <Badge variant="secondary" className="ml-auto text-[10px]">
                            {tCommon("comingSoon")}
                          </Badge>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 pb-1 text-xs text-muted-foreground">
          {tDisclaimer("short")}{" "}
          <Link href="/limiti" className="underline underline-offset-2 hover:text-foreground">
            {tDisclaimer("link")}
          </Link>
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
