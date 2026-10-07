import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Tutta l'app e' dinamica: la CSP usa un nonce per richiesta (src/proxy.ts) e ogni pagina legge
// sessione e database. Senza questo, in fase di build Next tenterebbe di prerenderizzare le pagine
// facendo partire query reali che poi abortisce a meta'.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: t("name"), template: `%s · ${t("name")}` },
    description: t("description"),
    // App privata: niente indicizzazione.
    robots: { index: false, follow: false },
  };
}

// Colori della barra del browser: coincidono con --background dei temi chiaro e scuro.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#171717" },
  ],
};

// Con tema «Sistema» la classe `dark` va decisa prima del primo disegno: uno script minimo, autorizzato dal nonce della CSP.
const SYSTEM_THEME_SCRIPT =
  "try{if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="it"
      // L'unica differenza attesa tra server e client e' la classe `dark` aggiunta dallo script del tema «Sistema».
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased${theme === "dark" ? " dark" : ""}`}
    >
      <body className="min-h-full flex flex-col">
        {theme === "system" ? <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} /> : null}
        <NextIntlClientProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
