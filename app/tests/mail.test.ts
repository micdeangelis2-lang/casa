import { describe, expect, it, vi } from "vitest";
import { noMail, resendMail } from "@/modules/deadlines/infrastructure/mail";

describe("invio email degli avvisi", () => {
  it("senza servizio configurato l'invio e' rifiutato in modo esplicito", async () => {
    expect(noMail.configured).toBe(false);
    await expect(noMail.send({ to: "a@example.test", subject: "s", text: "t" })).rejects.toThrow("Nessun servizio email configurato");
  });

  it("Resend: una sola richiesta POST con chiave nell'intestazione, destinatario in elenco e corpo JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const mail = resendMail("chiave-di-prova", "App <avvisi@example.test>", fetchImpl as unknown as typeof fetch);
    expect(mail.configured).toBe(true);
    await mail.send({ to: "a@example.test", subject: "Oggetto", text: "Corpo\nsu due righe" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer chiave-di-prova");
    expect(JSON.parse(init.body as string)).toEqual({ from: "App <avvisi@example.test>", to: ["a@example.test"], subject: "Oggetto", text: "Corpo\nsu due righe" });
  });

  it("una risposta non riuscita diventa un errore con il solo codice HTTP (mai la chiave ne' il corpo)", async () => {
    const mail = resendMail("segreta-123", "x@example.test", (async () => new Response("chiave segreta-123 non valida", { status: 403 })) as unknown as typeof fetch);
    const error = await mail.send({ to: "a@example.test", subject: "s", text: "t" }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Invio email non riuscito (HTTP 403)");
    expect((error as Error).message).not.toContain("segreta-123");
  });

  it("un errore di rete risale a chi chiama (il giro giornaliero lo conta come errore)", async () => {
    const mail = resendMail("k", "x@example.test", (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(mail.send({ to: "a@example.test", subject: "s", text: "t" })).rejects.toThrow("fetch failed");
  });
});
