import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const tApp = await getTranslations("app");
  const t = await getTranslations("webPolish.manifest");
  return {
    name: tApp("name"),
    short_name: t("shortName"),
    description: tApp("description"),
    lang: "it",
    dir: "ltr",
    display: "standalone",
    start_url: "/",
    scope: "/",
    background_color: "#ffffff",
    theme_color: "#171717",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
