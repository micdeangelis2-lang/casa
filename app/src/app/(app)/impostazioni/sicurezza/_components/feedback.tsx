import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Esito di un'azione: il messaggio positivo sta in una regione `role="status"` sempre presente (cosi' viene annunciato),
 * l'errore in un avviso `role="alert"`. I testi arrivano gia' risolti: nessun dettaglio interno.
 */
export function Feedback({ message, error }: { message?: string | null; error?: string | null }) {
  return (
    <>
      <div role="status" className="text-sm" data-testid="feedback-status">
        {message ?? null}
      </div>
      {error ? (
        <Alert variant="destructive" data-testid="feedback-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
