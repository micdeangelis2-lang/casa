import {
  Building2,
  CalendarClock,
  ClipboardCheck,
  FileText,
  HandCoins,
  Handshake,
  Home,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Settings,
  Share2,
  ShieldCheck,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type messages from "../../../../messages/it.json";

/** Chiavi vincolate ai messaggi: una voce senza traduzione non compila. */
export type NavGroupKey = keyof typeof messages.nav.groups;
export type NavItemKey = keyof typeof messages.nav.items;

export type NavItem = {
  key: NavItemKey;
  href: string;
  icon: LucideIcon;
  /** Moduli non ancora costruiti: voce visibile ma non cliccabile. */
  available: boolean;
};

export type NavGroup = { key: NavGroupKey; items: NavItem[] };

/**
 * Chiavi allineate a messages/it.json (`nav.groups.*` e `nav.items.*`).
 * Una voce passa a `available: true` quando il suo incremento e' consegnato.
 */
export const navGroups: NavGroup[] = [
  {
    key: "overview",
    items: [
      { key: "dashboard", href: "/", icon: LayoutDashboard, available: true },
      { key: "attention", href: "/controlli", icon: ClipboardCheck, available: true },
    ],
  },
  {
    key: "assets",
    items: [
      { key: "assets", href: "/immobili", icon: Home, available: true },
      { key: "documents", href: "/documenti", icon: FileText, available: true },
      { key: "rules", href: "/regole", icon: ListChecks, available: true },
      { key: "deadlines", href: "/scadenze", icon: CalendarClock, available: true },
    ],
  },
  {
    key: "management",
    items: [
      { key: "condominium", href: "/condominio", icon: Building2, available: true },
      { key: "taxes", href: "/tributi", icon: Landmark, available: true },
      { key: "works", href: "/manutenzioni", icon: Wrench, available: true },
      { key: "insurance", href: "/assicurazioni", icon: ShieldCheck, available: true },
      { key: "lettings", href: "/locazioni", icon: HandCoins, available: true },
      { key: "economy", href: "/economia", icon: Wallet, available: true },
    ],
  },
  {
    key: "people",
    items: [
      { key: "directory", href: "/rubrica", icon: Users, available: true },
      { key: "matters", href: "/pratiche", icon: Handshake, available: true },
      { key: "sharing", href: "/condivisione", icon: Share2, available: true },
    ],
  },
  {
    key: "system",
    items: [{ key: "settings", href: "/impostazioni", icon: Settings, available: true }],
  },
];
