# API HTTP

Le route sotto `app/src/app/api/` sono una per ogni `route.ts`. Servono soprattutto a scaricare file (documenti, backup, CSV, calendario) e a due compiti di sistema (cron, controllo di salute). Non sono un'API pubblica per terzi: l'interfaccia dell'app usa soprattutto pagine e azioni del server.

Il test `app/tests/docs-routes.test.ts` fallisce se esiste un `route.ts` che non compare in questo file: aggiungendo una route, va descritta qui (percorso del file e indirizzo).

## Regole comuni

- **Autenticazione.** Tutte le route, tranne tre eccezioni, chiamano `getOwnerForApi()` (`app/src/platform/auth/owner.ts`): restituisce il proprietario solo se la sessione è valida **e** la configurazione di sicurezza è completa (TOTP attivo e almeno una passkey). Altrimenti la route risponde **401**, senza corpo (l'unica eccezione al corpo vuoto è `/api/territori`, che risponde JSON). Le pagine, al contrario, reindirizzano a `/accesso` (307).

- **Richieste cross-site.** Le route di scarico (tutte tranne `/api/territori`, `auth`, `cron`, `health`) rifiutano con **403**, senza corpo, le richieste con `Sec-Fetch-Site` diverso da `same-origin` e `none` (`app/src/platform/auth/request-guard.ts`); l'assenza dell'intestazione è ammessa. Il controllo precede quello della sessione. Provato in `e2e/security-fixes.spec.ts`.
- **Le tre eccezioni**: `/api/auth/*` (le rotte dell'accesso, gestite da Better Auth), `/api/cron/*` (segreto `CRON_SECRET`) e `/api/health` (pubblica di proposito, E57). Lo impone `app/tests/authz.test.ts`.
- **Intestazioni dei download.** Le route che restituiscono file mettono `X-Content-Type-Options: nosniff` e `Cache-Control: private, no-store` (il file di un proprietario non deve finire in una cache condivisa) e `Content-Disposition`.
- **Identificativi.** Un identificativo nel percorso che non è un UUID dà **404** (non 400): è la stessa risposta di un oggetto che non esiste.
- **Metodi.** Ogni route definisce solo i metodi indicati sotto (`GET`, e `POST` per l'accesso). Il comportamento di Next.js per gli altri metodi (405) non è verificato da un test del progetto.
- **Content-Type dei CSV.** `text/csv; charset=utf-8`, con separatore `;`, BOM UTF-8 e celle neutralizzate contro le formule (`app/src/shared/csv.ts`).

## Riepilogo

| Metodo e indirizzo | File | Autenticazione | Risposta |
|---|---|---|---|
| `GET`/`POST /api/auth/[...all]` | `src/app/api/auth/[...all]/route.ts` | nessuna (è l'accesso) | Better Auth |
| `GET /api/backup/[id]` | `src/app/api/backup/[id]/route.ts` | sessione | archivio cifrato `.gibk` |
| `GET /api/calendario` | `src/app/api/calendario/route.ts` | sessione | `.ics` |
| `GET /api/condivisione/[id]` | `src/app/api/condivisione/[id]/route.ts` | sessione | ZIP del pacchetto |
| `GET /api/condominio/controllo` | `src/app/api/condominio/controllo/route.ts` | sessione | CSV |
| `GET /api/pratiche/[id]/cronologia` | `src/app/api/pratiche/[id]/cronologia/route.ts` | sessione | CSV |
| `GET /api/cron/backup` | `src/app/api/cron/backup/route.ts` | `CRON_SECRET` | JSON |
| `GET /api/cron/giornaliero` | `src/app/api/cron/giornaliero/route.ts` | `CRON_SECRET` | JSON |
| `GET /api/documenti/[id]/[versionId]` | `src/app/api/documenti/[id]/[versionId]/route.ts` | sessione | byte del file |
| `GET /api/economia` | `src/app/api/economia/route.ts` | sessione | CSV |
| `GET /api/locazioni/rendiconto` | `src/app/api/locazioni/rendiconto/route.ts` | sessione | CSV |
| `GET /api/economia/dossier` | `src/app/api/economia/dossier/route.ts` | sessione | CSV |
| `GET /api/immobili/[id]/scheda-tecnica` | `src/app/api/immobili/[id]/scheda-tecnica/route.ts` | sessione | CSV |
| `GET /api/immobili/[id]/scheda-notaio` | `src/app/api/immobili/[id]/scheda-notaio/route.ts` | sessione | CSV |
| `GET /api/immobili/[id]/scheda-agente` | `src/app/api/immobili/[id]/scheda-agente/route.ts` | sessione | CSV |
| `GET /api/manutenzioni/impianti` | `src/app/api/manutenzioni/impianti/route.ts` | sessione | CSV |
| `GET /api/assicurazioni/per-immobile` | `src/app/api/assicurazioni/per-immobile/route.ts` | sessione | CSV |
| `GET /api/esportazione` | `src/app/api/esportazione/route.ts` | sessione | ZIP in chiaro |
| `GET /api/importa/modello` | `src/app/api/importa/modello/route.ts` | sessione | CSV (modello) |
| `GET /api/health` | `src/app/api/health/route.ts` | nessuna | JSON |
| `GET /api/territori` | `src/app/api/territori/route.ts` | sessione | JSON |
| `GET /api/tributi/riepilogo` | `src/app/api/tributi/riepilogo/route.ts` | sessione | CSV |

---

## Accesso

### `GET` e `POST /api/auth/[...all]`

File: `src/app/api/auth/[...all]/route.ts`.

- **Autenticazione**: nessuna sul gestore; le singole rotte di Better Auth applicano le loro regole. La registrazione pubblica è spenta (`emailAndPassword.disableSignUp: true` in `src/platform/auth/auth.ts`): `POST /api/auth/sign-up/email` fallisce (lo verifica `e2e/auth.spec.ts`, risposta non riuscita e sotto 500). L'unico account si crea dalla pagina `/configurazione-iniziale` con `OWNER_BOOTSTRAP_TOKEN`.
- **Cosa fa**: inoltra la richiesta a `toNextJsHandler(getAuth())`. L'istanza si crea alla prima richiesta (`dynamic = "force-dynamic"`).
- **Percorsi usati dall'app**: accesso con password `/api/auth/sign-in/email`, con passkey `/api/auth/sign-in/passkey`, secondo fattore `/api/auth/two-factor/*`. L'elenco completo delle rotte è quello di Better Auth (versione in `app/package.json`) e non è riprodotto qui.
- **Limite di frequenza** (database, indirizzo letto da `x-real-ip`): 60 richieste al minuto in generale; 5 per `/sign-in/email`, 10 per `/sign-in/passkey`, 5 per `/two-factor/*`. Superato il limite: **429** (provato in `e2e/auth.spec.ts` per `/sign-in/email`).
- **Codici**: 401 password errata (provato), 429 limite superato (provato); gli altri sono quelli di Better Auth.

---

## Download dell'archivio

### `GET /api/backup/[id]`

File: `src/app/api/backup/[id]/route.ts`. Scarica un backup già fatto, **sempre cifrato**.

- **Autenticazione**: sessione del proprietario.
- **Parametri**: `id` = UUID di una riga dello storico `backup_run`.
- **Risposta 200**: flusso di byte, `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<chiave di destinazione>"`, `Content-Length` (dimensione registrata), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401 senza sessione; 404 se l'`id` non è un UUID, se il backup non esiste, se non è in stato `completed` o `warning`, se non ha una chiave di destinazione o se il file non c'è più nella destinazione.

### `GET /api/esportazione`

File: `src/app/api/esportazione/route.ts`. Esportazione completa **in chiaro e senza credenziali** (niente `user`, `account`, `passkey`, `two_factor`).

- **Autenticazione**: sessione del proprietario.
- **Parametri**: nessuno.
- **Risposta 200**: ZIP generato a flusso (`application/zip`), nome `gestione-immobili-esportazione-AAAA-MM-GG.zip`, stesse intestazioni di sicurezza e di cache di sopra. L'evento `backup.export` entra nell'audit (solo conteggi).
- **Codici**: 401.

### `GET /api/importa/modello`

File: `src/app/api/importa/modello/route.ts`. Modello CSV per la pagina `/importa`: intestazioni e una riga di esempio fittizia. Formato come gli altri CSV dell'app: separatore `;`, UTF-8 con BOM, fine riga CRLF (`csvDocument`).

- **Autenticazione**: sessione del proprietario; richieste da altri siti rifiutate (`rejectCrossSite`).
- **Parametri**: `tipo` = `contatti`, `immobili`, `scadenze`, `canoni`, `tributi`, `pagamenti-tributi` oppure `polizze`. La riga di esempio inizia con «ESEMPIO»: in anteprima risulta «saltata (riga di esempio)» e non si importa mai.
- **Risposta 200**: `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="modello-<tipo>.csv"` (per esempio `modello-contatti.csv`), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 400 se `tipo` manca o non è valido; 401 senza sessione.

### `GET /api/condivisione/[id]`

File: `src/app/api/condivisione/[id]/route.ts`. Scarica un pacchetto di condivisione (snapshot memorizzato alla creazione, file con impronta verificata). Lo ZIP contiene `INDEX.html`, `manifest.json`, `elenco.csv`, i documenti in `files/` e, se scelta alla creazione, la scheda `SCHEDA.html` (pagina HTML autonoma, senza script né risorse esterne, generata dallo snapshot).

- **Autenticazione**: sessione del proprietario.
- **Parametri**: `id` = UUID del pacchetto.
- **Effetto collaterale**: lo scarico è registrato nel registro delle condivisioni, in una transazione con audit (`preparePackageDownload`), prima che parta il flusso.
- **Risposta 200**: ZIP generato a pezzi (`application/zip`), `Content-Disposition: attachment` col nome del pacchetto, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401; 404 se l'`id` non è un UUID o il pacchetto non esiste; **410** se il pacchetto è stato revocato (provato in `e2e/matters-sharing.spec.ts`).

### `GET /api/documenti/[id]/[versionId]`

File: `src/app/api/documenti/[id]/[versionId]/route.ts`. Restituisce i byte di una versione di un documento. Mai URL pubblici (E19).

- **Autenticazione**: sessione del proprietario.
- **Parametri**: `id` = UUID del documento, `versionId` = UUID della versione; query facoltativa `scarica=1` per forzare il download.
- **Risposta 200**: flusso del file con il suo `Content-Type` e `Content-Length`. PDF e immagini (`application/pdf`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`) si aprono `inline`; il resto, o con `scarica=1`, è `attachment`. `Content-Disposition` porta `filename` (solo ASCII) e `filename*=UTF-8''…`. Inoltre `nosniff` e `Cache-Control: private, no-store`.
- **Codici**: 401; 404 se uno dei due UUID non è valido o la versione non esiste.

---

## Esportazioni in formato aperto

### `GET /api/pratiche/[id]/cronologia`

File: `src/app/api/pratiche/[id]/cronologia/route.ts`. La cronologia dei fatti registrati di una pratica (pratica, richieste, pareri, documenti, sinistri e voci del condominio collegati, scadenze, canoni) in CSV («;», BOM, date gg/mm/aaaa). Il file **contiene dati della pratica**: conservalo come gli altri documenti.

- **Autenticazione**: sessione del proprietario.
- **Parametri**: `id` (UUID della pratica).
- **Risposta 200**: `text/csv; charset=utf-8`, `Content-Disposition: attachment`, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401; 404 se l'UUID non è valido o la pratica non esiste.

### `GET /api/condominio/controllo`

File: `src/app/api/condominio/controllo/route.ts`. Le viste «Controllo con l'amministratore» in CSV: versamenti rispetto alle rate, cosa non risulta tra i documenti collegati, registro delle delibere.

- **Autenticazione**: sessione del proprietario.
- **Parametri** (query): `vista` obbligatoria (`versamenti`, `consegne` o `delibere`); `condominio` (UUID, facoltativo); solo per `delibere`: `esito`, `anno` (quattro cifre), `senzaSeguito=1`.
- **Risposta 200**: CSV, `Content-Disposition: attachment; filename="condominio-<vista>.csv"`, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401; 400 con corpo `Vista non valida`.

### `GET /api/calendario`

File: `src/app/api/calendario/route.ts`. Le scadenze aperte e non archiviate come calendario `.ics` (eventi «tutto il giorno», promemoria alle 9:00 per ogni preavviso, `UID` stabile). Il file **contiene titoli e nomi degli immobili**.

- **Autenticazione**: sessione del proprietario.
- **Parametri**: nessuno.
- **Risposta 200**: `text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="scadenze-immobili.ics"`, `nosniff`, `Cache-Control: private, no-store`. È un file scaricato, non un abbonamento.
- **Codici**: 401.

### `GET /api/immobili/[id]/scheda-tecnica`

File: `src/app/api/immobili/[id]/scheda-tecnica/route.ts`. Scheda per il tecnico di un immobile in CSV: scheda del bene, catasto a storico, titolarità, documenti tecnici, voci del dossier da raccogliere, interventi, garanzie, ispezioni, scadenze e pratiche aperte. Elenca ciò che risulta registrato, senza giudizi di conformità.

- **Autenticazione**: sessione del proprietario.
- **Parametri** (percorso): `id`, UUID di un immobile.
- **Risposta 200**: CSV, `Content-Disposition: attachment; filename="scheda-tecnica-<data>.csv"`, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401; 404 se `id` non è un UUID o l'immobile non esiste.

### `GET /api/immobili/[id]/scheda-notaio`

File: `src/app/api/immobili/[id]/scheda-notaio/route.ts`. Scheda dell'immobile per il notaio in CSV: bene, titolarità con codice fiscale e indirizzo dei titolari (se in rubrica), somma delle quote, catasto a storico, documenti per categoria, provenienza e gravami registrati, voci del dossier aperte, pertinenze, dati che non risultano. Il file **contiene dati personali dei titolari**. Nessun giudizio sull'atto né sul bene.

- **Autenticazione**: sessione del proprietario.
- **Parametri**: `id` (percorso), UUID di un immobile; `categoria` (query, ripetibile), UUID delle categorie documentali da controllare (default: quelle della pagina).
- **Risposta 200**: CSV (`;`, BOM, CRLF, date gg/mm/aaaa), `Content-Disposition: attachment; filename="scheda-notaio-<id>.csv"`, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401; 404 se `id` non è un UUID o l'immobile non esiste.

### `GET /api/immobili/[id]/scheda-agente`

File: `src/app/api/immobili/[id]/scheda-agente/route.ts`. Scheda per l'agente immobiliare in CSV, con le scelte della pagina: i documenti più riservati del livello scelto non sono elencati (se ne indica il numero), i nomi dei titolari compaiono solo con `titolari=1`, i nomi degli inquilini non compaiono mai. Nessuna stima di valore.

- **Autenticazione**: sessione del proprietario.
- **Parametri**: `id` (percorso), UUID; `livello` (query: `ordinary` predefinito, `reserved`, `highly_reserved`); `categoria` (ripetibile); `titolari=1`.
- **Risposta 200**: CSV, `Content-Disposition: attachment; filename="scheda-agente-<id>.csv"`, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401; 404 se `id` non è un UUID o l'immobile non esiste.

### `GET /api/manutenzioni/impianti`

File: `src/app/api/manutenzioni/impianti/route.ts`. Registro degli impianti in CSV, con i filtri della pagina: impianti, verifiche periodiche, garanzie, interventi e documenti collegati, date da guardare. Riporta le date scritte dal proprietario; non dice se un impianto sia a norma.

- **Autenticazione**: sessione del proprietario.
- **Parametri** (query, tutti facoltativi): `immobile` (UUID), `tipo` (codice del tipo di impianto, oppure `other`), `giorni` (1–365, finestra di «in scadenza»; default 60). Valori non validi vengono ignorati.
- **Risposta 200**: CSV, `Content-Disposition: attachment; filename="registro-impianti-<data>.csv"`, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401.

### `GET /api/assicurazioni/per-immobile`

File: `src/app/api/assicurazioni/per-immobile/route.ts`. Polizze registrate per immobile in CSV: anche gli immobili senza polizza (una riga con la situazione) e le polizze senza immobile collegato; garanzie copiate a mano dal contratto. Non interpreta le condizioni di polizza.

- **Autenticazione**: sessione del proprietario.
- **Parametri**: nessuno.
- **Risposta 200**: CSV, `Content-Disposition: attachment; filename="polizze-per-immobile-<data>.csv"`, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401.

### `GET /api/economia`

File: `src/app/api/economia/route.ts`. Quadro economico di un anno in CSV (somma di ciò che è stato registrato, mai ripartito tra immobili: la riga «Non ripartito» raccoglie ciò che non si può attribuire).

- **Autenticazione**: sessione del proprietario.
- **Parametri** (query): `anno` obbligatorio, quattro cifre (`^\d{4}$`); `immobile` facoltativo, UUID di un immobile (un valore che non è un UUID viene ignorato, non è un errore).
- **Risposta 200**: CSV, `Content-Disposition: attachment; filename="quadro-economico-<anno>.csv"`, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401; **400** con corpo testuale `Anno non valido` se `anno` manca o non è di quattro cifre (provato in `e2e/economy.spec.ts`).

### `GET /api/locazioni/rendiconto`

File: `src/app/api/locazioni/rendiconto/route.ts`. Rendiconto di gestione di un immobile per un periodo in CSV: canoni, incassi e pagamenti registrati, interventi, codici identificativi, adempimenti, mandato. Solo ciò che risulta dai dati; nessun giudizio.

- **Autenticazione**: sessione del proprietario.
- **Parametri** (query): `immobile` obbligatorio (UUID); `dal` e `al` facoltativi (`AAAA-MM-GG`; default: dall'inizio dell'anno a oggi).
- **Risposta 200**: CSV, `Content-Disposition: attachment; filename="rendiconto-gestione-<dal>-<al>.csv"`, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401; **400** `Immobile non valido`; **404** `Immobile non trovato`.

### `GET /api/economia/dossier`

File: `src/app/api/economia/dossier/route.ts`. Dossier annuale per il commercialista in CSV: titolarità e dati catastali, locazioni, pagamenti con o senza documento di prova, tributi, dichiarazioni, elenco dei dati non registrati. Nessun calcolo fiscale.

- **Autenticazione**: sessione del proprietario.
- **Parametri** (query): `anno` obbligatorio, quattro cifre.
- **Risposta 200**: CSV, `Content-Disposition: attachment; filename="dossier-commercialista-<anno>.csv"`, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401; **400** con corpo `Anno non valido`.

### `GET /api/tributi/riepilogo`

File: `src/app/api/tributi/riepilogo/route.ts`. Riepilogo dei tributi di un anno per il consulente, in CSV.

- **Autenticazione**: sessione del proprietario.
- **Parametri** (query): `anno` obbligatorio, quattro cifre.
- **Risposta 200**: CSV, `Content-Disposition: attachment; filename="riepilogo-tributi-<anno>.csv"`, `nosniff`, `Cache-Control: private, no-store`.
- **Codici**: 401; 400 con corpo `Anno non valido` (provato in `e2e/taxes.spec.ts`).

---

## Ricerca di territori

### `GET /api/territori`

File: `src/app/api/territori/route.ts`. Alimenta il selettore di territori (Comuni, province…).

- **Autenticazione**: sessione del proprietario.
- **Parametri** (query): `q` testo cercato (vuoto se manca); `kinds` elenco separato da virgole tra `country`, `region`, `province`, `municipality`, `locality` (predefinito `municipality`; i valori sconosciuti sono scartati in silenzio).
- **Risposta 200**: JSON `{ "results": [{ "id": "<uuid>", "label": "<etichetta>" }] }`, al massimo 15 risultati, `Cache-Control: private, no-store`.
- **Codici**: **401** con corpo JSON `{ "error": "Non autorizzato" }` (è l'unica route con un corpo nel 401).

---

## Sistema

### `GET /api/cron/giornaliero`

File: `src/app/api/cron/giornaliero/route.ts`. Il giro giornaliero (`runDailyJob` in `src/lib/daily-job.ts`): rivaluta tutti i dossier, calcola le nuove date delle scadenze, crea gli avvisi dovuti e invia le email. Idempotente. Pianificato alle 05:00 UTC in `app/vercel.json`.

- **Autenticazione**: intestazione `Authorization: Bearer <CRON_SECRET>`, confronto a tempo costante (`timingSafeEqual`). Senza `CRON_SECRET` configurato la route è chiusa. L'autore nell'audit è `system/cron`.
- **Parametri**: nessuno.
- **Risposta 200**: JSON `{ "ok": true, "occurrences": n, "notifications": n, "emails": n, "emailErrors": n, "evaluated": n }` (conteggi; `evaluated` = beni rivalutati).
- **Codici**: 401 senza segreto o con segreto sbagliato (provato in `e2e/deadlines.spec.ts`); 500 con `{ "ok": false, "message": "<testo>" }` se il giro lancia un errore.
- **Non provato su Vercel** (serve l'account): vedi `DECISIONS.md`, E37.

### `GET /api/cron/backup`

File: `src/app/api/cron/backup/route.ts`. Fa un backup cifrato (`runBackup`, attivazione `scheduled`).

- **Autenticazione**: come sopra (`Authorization: Bearer <CRON_SECRET>`), autore `system/cron`.
- **Parametri**: nessuno.
- **Risposta 200**: JSON `{ "ok": true, "status": "<stato del backup>" }`.
- **Codici**: 401; 500 con `{ "ok": false, "message": "<testo>" }` se il backup fallisce (ad esempio senza `BACKUP_PUBLIC_KEY`).
- **Non è in `vercel.json`**: su Vercel la destinazione a disco non funziona (E15, E25). Si può chiamare a mano con il segreto.

### `GET /api/health`

File: `src/app/api/health/route.ts`. Controllo di salute per un monitoraggio esterno.

- **Autenticazione**: nessuna, di proposito (E57). Non legge dati dell'archivio, non importa moduli e non espone il motivo di un errore (lo impone `tests/authz.test.ts`).
- **Parametri**: nessuno.
- **Risposta 200**: `{ "status": "ok" }` se `select 1` va a buon fine entro 3 secondi.
- **Risposta 503**: `{ "status": "error" }` se il database dà errore o non risponde entro 3 secondi.
- **Intestazioni**: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
