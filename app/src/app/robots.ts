import type { MetadataRoute } from "next";

// App privata: nessun motore di ricerca deve indicizzarla (coerente con `robots: { index: false }` nei metadati).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
