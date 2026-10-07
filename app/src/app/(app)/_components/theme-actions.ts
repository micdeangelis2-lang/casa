"use server";

import { cookies } from "next/headers";
import { requireOwner } from "@/platform/auth/owner";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

/** Memorizza la preferenza di tema (cookie). Non scrive nel database: nessun dato dell'archivio, quindi niente audit. */
export async function setThemeAction(value: string): Promise<void> {
  await requireOwner();
  const store = await cookies();
  store.set(THEME_COOKIE, parseTheme(value), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}
