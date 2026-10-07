import { createElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import AppError from "@/app/(app)/error";
import GlobalError from "@/app/global-error";
import messages from "../messages/it.json";

/**
 * Le pagine di errore non devono mai far trapelare il messaggio dell'errore (potrebbe contenere dati personali): mostrano
 * solo il codice con cui si ritrova nei log. Si rendono qui per scorrere il testo vero che vedrebbe l'utente.
 */

const Provider = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: typeof messages; children?: ReactNode }>;
const wrap = (child: ReactElement) => createElement(Provider, { locale: "it", messages }, child);

const failure = Object.assign(new Error("Failed query: select * from party where tax_code = 'RSSMRA80A01H501U'"), { digest: "d1g3st" });

describe("pagine di errore", () => {
  it("l'errore dell'area riservata e' in italiano, mostra il codice e non il messaggio", () => {
    const html = renderToStaticMarkup(wrap(createElement(AppError, { error: failure, reset: () => undefined })));
    expect(html).toContain("Qualcosa non ha funzionato");
    expect(html).toContain("Codice dell&#x27;errore: d1g3st");
    expect(html).toContain("Riprova");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("RSSMRA80A01H501U");
    expect(html).not.toContain("Failed query");
  });

  it("l'ultima rete di sicurezza e' in italiano e non mostra il messaggio", () => {
    const html = renderToStaticMarkup(createElement(GlobalError, { error: failure, reset: () => undefined }));
    expect(html).toContain('lang="it"');
    expect(html).toContain("Qualcosa non ha funzionato");
    expect(html).toContain("d1g3st");
    expect(html).not.toContain("RSSMRA80A01H501U");
  });

  it("senza codice l'errore non mostra una riga vuota", () => {
    const html = renderToStaticMarkup(wrap(createElement(AppError, { error: new Error("x"), reset: () => undefined })));
    expect(html).not.toContain("Codice dell");
  });
});
