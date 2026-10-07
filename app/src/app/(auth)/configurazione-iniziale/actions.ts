"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/platform/auth/auth";
import { bootstrapOwner, ownerExists } from "@/platform/auth/bootstrap";

export type BootstrapFormState = {
  error?: "invalid_token" | "bootstrap_disabled" | "already_initialized" | "invalid_input" | "generic";
  fieldErrors?: Record<string, string[]>;
  /** Valori da ripresentare dopo un errore; la password e il token non si rimandano mai al client. */
  values?: { name: string; email: string };
};

export async function bootstrapAction(
  _previous: BootstrapFormState,
  formData: FormData,
): Promise<BootstrapFormState> {
  if (await ownerExists()) redirect("/accesso");

  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const token = String(formData.get("token") ?? "");

  const result = await bootstrapOwner({ name, email, password, token });
  if (!result.ok) {
    if (result.reason === "invalid_input") {
      return { error: "invalid_input", fieldErrors: result.fieldErrors, values: { name, email } };
    }
    return { error: result.reason, values: { name, email } };
  }

  // Sessione subito dopo la creazione: l'utente prosegue con la configurazione della sicurezza.
  // I cookie li imposta il plugin nextCookies.
  await getAuth().api.signInEmail({ body: { email: result.email, password }, headers: await headers() });
  redirect("/sicurezza/configurazione");
}
