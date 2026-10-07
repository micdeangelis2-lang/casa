import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotFoundCard } from "@/components/not-found-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("problems.notFound");
  return { title: t("title") };
}

/** Indirizzo sconosciuto (fuori dall'area riservata). Non rivela nulla dell'app. */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <NotFoundCard />
    </main>
  );
}
