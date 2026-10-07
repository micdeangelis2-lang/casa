"use client";

/**
 * Ultima rete di sicurezza: scatta solo se fallisce il layout principale, quando non c'e' piu' ne' il fornitore dei
 * messaggi ne' lo stile dell'app. Per questo il testo e' scritto qui e non nei messaggi.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="it">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, padding: "1.5rem" }}>
        <main role="alert" style={{ maxWidth: "32rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem" }}>Qualcosa non ha funzionato</h1>
          <p style={{ color: "#444" }}>L&apos;app non si è caricata. Riprova; se capita ancora, annota il codice qui sotto.</p>
          {error.digest ? <p style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#444" }}>Codice dell&apos;errore: {error.digest}</p> : null}
          <button type="button" onClick={reset} style={{ padding: "0.5rem 1rem", fontSize: "1rem", minHeight: "2.5rem" }}>
            Riprova
          </button>
        </main>
      </body>
    </html>
  );
}
