import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ownerExists } from "@/platform/auth/bootstrap";
import { getOwnerSession } from "@/platform/auth/owner";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signIn");
  return { title: t("title") };
}

export default async function SignInPage() {
  // Nessun proprietario: prima la configurazione iniziale.
  if (!(await ownerExists())) redirect("/configurazione-iniziale");
  // Gia' autenticato: la verifica della configurazione completa la fa requireOwner() nell'app.
  if (await getOwnerSession()) redirect("/");
  return <SignInForm />;
}
