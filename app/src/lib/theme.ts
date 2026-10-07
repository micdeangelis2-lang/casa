/** Preferenza di tema: cookie letto dal server (classe sull'<html>), senza script inline non autorizzati dalla CSP. */
export const THEME_COOKIE = "theme";
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(value: string | undefined): Theme {
  return THEMES.find((theme) => theme === value) ?? "system";
}
