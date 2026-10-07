"use client";

import { useEffect, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setThemeAction } from "@/app/(app)/_components/theme-actions";
import { THEMES, type Theme } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Selettore Chiaro / Scuro / Sistema. Con «Sistema» la classe `dark` segue la preferenza del sistema (anche se cambia mentre l'app e' aperta). */
export function ThemeToggle({ theme }: { theme: Theme }) {
  const t = useTranslations("webPolish.theme");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia(DARK_QUERY);
    const apply = () => document.documentElement.classList.toggle("dark", media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return (
    <div role="group" aria-label={t("label")} className="flex items-center rounded-md border p-0.5" data-testid="theme-toggle">
      {THEMES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          disabled={pending}
          data-theme-option={value}
          onClick={() => startTransition(() => setThemeAction(value))}
          className="rounded-sm px-2 py-1 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
        >
          {t(value)}
        </button>
      ))}
    </div>
  );
}
