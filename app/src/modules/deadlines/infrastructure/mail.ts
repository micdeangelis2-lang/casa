import type { MailPort } from "../application/ports";

/** Nessun servizio email: gli avvisi restano solo nell'app. */
export const noMail: MailPort = {
  configured: false,
  async send() {
    throw new Error("Nessun servizio email configurato");
  },
};

/**
 * Invio con Resend (regione UE a scelta nell'account). Usa solo `fetch`: nessuna dipendenza.
 * NON verificato con un account reale (vedi DECISIONS.md): il corpo e' quello documentato dall'API.
 */
export function resendMail(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): MailPort {
  return {
    configured: true,
    async send({ to, subject, text }) {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (!response.ok) throw new Error(`Invio email non riuscito (HTTP ${response.status})`);
    },
  };
}
