import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ownerExists } from "@/platform/auth/bootstrap";
import { BootstrapForm } from "./bootstrap-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.bootstrap");
  return { title: t("title") };
}

export default async function BootstrapPage() {
  // Dopo il primo account questa pagina non esiste piu': si va all'accesso.
  if (await ownerExists()) redirect("/accesso");
  return <BootstrapForm />;
}
