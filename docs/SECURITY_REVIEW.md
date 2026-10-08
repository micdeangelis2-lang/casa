# Revisione di sicurezza indipendente — Gestione Immobili

Data: 2026-10-06. Metodo: lettura del codice sotto `app/src`, `app/scripts`, `.github`, della configurazione e del codice di Better Auth 1.7.7 / `@better-auth/passkey` effettivamente installato; prove eseguibili in una cartella di scratch fuori dal progetto (nessun file del progetto modificato; nessun server avviato; nessun database toccato).

Modello di minaccia: app privata a un solo utente, dietro passkey + TOTP. Un attaccante realistico è (a) un sito malevolo che l'utente visita mentre è collegato, (b) chi ruba una sessione o un dispositivo, (c) chi invia al proprietario un file ostile (PDF, ZIP), (d) chi ha accesso in scrittura alla cartella dei backup, (e) chi raggiunge l'app da Internet senza account. Non sono cercati i problemi di un servizio multi-utente: tutte le pagine appartengono al proprietario, quindi un «IDOR» tra utenti non esiste per costruzione.

Legenda: **CONFERMATO** = verificato leggendo il codice che decide il comportamento e/o eseguendo una prova; **PLAUSIBILE** = il difetto è nel codice ma lo sfruttamento dipende da condizioni che non ho potuto verificare (ambiente di produzione, servizi reali).

Esito sintetico: **nessuna vulnerabilità critica o alta**. Nessuna falla di accesso non autenticato, nessuna iniezione, nessun XSS, nessun attraversamento di percorsi trovati. Due controlli dichiarati nel codice non fanno ciò che i commenti dicono (F-01, F-04); un'ipotesi di distribuzione da riconfermare (F-02).

## Stato delle correzioni (2026-10-07)

| Id | Esito | Dove / prova |
|---|---|---|
| F-01 | **Corretto** | `auth.ts`: `passkey({ registration.afterVerification, authentication.afterVerification })` rifiutano (401) se `userVerified` non è `true`. Il gancio di accesso gira dopo la verifica della firma e prima dell'aggiornamento del contatore e della sessione (letto in `@better-auth/passkey/dist/index.mjs`). Prova: `e2e/security-fixes.spec.ts` (autenticatore virtuale con UV spento: accesso rifiutato; con UV acceso: entra) e `e2e/auth.spec.ts`, `security-page.spec.ts` (registrazione e accesso con UV restano verdi). |
| F-02 | **Non risolvibile qui** | Dipende dall'hosting. Aggiunto un promemoria a `pnpm doctor` (`auth.client_ip`, livello ok con indicazione, `tests/doctor.test.ts`). Da verificare dopo il primo deploy su Vercel: inviare una richiesta con `x-real-ip: 1.2.3.4` e controllare che l'indirizzo registrato nell'audit (accesso di prova) sia quello reale e non quello inviato; se Vercel non lo sovrascrive, passare a `trustedProxies` con `x-forwarded-for`. |
| F-03 | **Corretto** | `hooks.before` chiude `/change-password` e `/two-factor/generate-backup-codes` quando c'è una richiesta HTTP (`ctx.request`); le azioni del server le chiamano come funzione e restano il solo percorso. Tetto di 5 tentativi per 15 minuti (finestra fissa, azzerato da una password corretta) in `takePasswordAttempt`/`clearPasswordAttempts` (`account-security.ts`), nella tabella `rate_limit` con chiave `owner-password-actions\|<userId>` (nessuna tabella nuova), prenotato prima della verifica con un solo UPSERT (le richieste parallele non lo superano). Prova: `tests/security-fixes.test.ts` (incluso il caso parallelo), `e2e/security-fixes.spec.ts` (403 sulle rotte dirette con sessione valida; sesta password sbagliata: «Troppi tentativi»). |
| F-04 | **Corretto** (riconferma recente, senza schema) | Nuovi `platform/auth/reconfirmation.ts` (logica pura), `recent-auth.ts` (cookie e risposte), pagina `/riconferma` (`app/(app)/riconferma/*`). Esportazione completa (`/api/esportazione`), scarico dei backup (`/api/backup/[id]`) e dei pacchetti (`/api/condivisione/[id]`) e le azioni della pagina Sicurezza (rimozione passkey, chiusura sessioni, rigenerazione dei codici, cambio password) pretendono una **riconferma negli ultimi 10 minuti**: password + codice TOTP (o di recupero) oppure passkey. La prova è un cookie `gi_reconfirm` (httpOnly, SameSite=Strict, `Secure` in https, 10 minuti) firmato con HMAC-SHA256 da una chiave derivata da `BETTER_AUTH_SECRET`, legato all'id utente e all'id della sessione: non vale su un'altra sessione né per un altro utente. Nessuna colonna nuova. Le route rispondono a una **navigazione del browser** (`Sec-Fetch-Mode: navigate`/`Dest: document`, oppure `Accept: text/html` se mancano le intestazioni `Sec-Fetch-*`) con **303** verso `/riconferma?ritorno=<percorso>`; a ogni altra richiesta con **403** e `{"error":"reconfirm_required","reconfirm":"/riconferma?..."}` (401 resta «nessuna sessione»). Il ritorno è validato (`safeReturnPath`): solo percorsi interni che iniziano con una sola `/`, senza `\`, caratteri di controllo o schemi, lunghezza massima 500, mai `/riconferma` stessa; altrimenti «/». La via password verifica l'hash dell'account e il codice con `auth.api.verifyTOTP`/`verifyBackupCode` (senza creare sessioni) e condivide il tetto di 5 tentativi per 15 minuti di F-03; la via passkey passa da `signIn.passkey()` (verifica UV imposta da F-01), che crea una sessione nuova: l'azione `reconfirmAfterPasskeyAction` concede il cookie solo se la sessione in uso ha meno di 60 secondi. Audit: `owner.reconfirm` con il solo metodo. Prova: `tests/reconfirmation.test.ts` (scadenza, manomissione, utente e sessione diversi, segreto diverso, istante futuro, open redirect, riconoscimento della navigazione), `e2e/reconfirm.spec.ts` (403 JSON e 303 sulle tre route, 401 senza sessione, cookie falso, azioni di Sicurezza rifiutate senza riconferma, password/codice sbagliati, riconferma vera con password+TOTP e con passkey virtuale, anti open redirect, link di scarico → riconferma → file). Adeguamento degli altri e2e: `e2e/support/reconfirm.ts` fabbrica lo stesso cookie col segreto di PROVA per la sessione reale del contesto (`backup`, `matters-sharing`, `security-fixes`, `security-page`); il controllo del server non cambia. Limiti: il codice di recupero come secondo fattore della riconferma non è coperto da un e2e (consumerebbe un codice condiviso); l'attacco con cookie di sessione rubato **entro** 10 minuti da una riconferma legittima non è mitigato. |
| F-05 | **Corretto** | `rejectCrossSite()` (`platform/auth/request-guard.ts`) in 12 route di scarico: 403 se `Sec-Fetch-Site` non è `same-origin`/`none`; l'assenza è ammessa. Esclusa `/api/territori` (JSON per `fetch` interno). Prova: `tests/security-fixes.test.ts` (funzione pura + controllo statico che nessuna route lo dimentichi), `e2e/security-fixes.spec.ts` (esportazione, calendario, economia: 403 con cross-site e same-site; 200 con same-origin, none e senza intestazione). Non copre `Origin`/`Referer` in assenza di `Sec-Fetch-Site` (browser molto vecchi). |
| F-06 | **Corretto** (firma HMAC, senza schema) | `modules/backup/application/signature.ts`. Il manifest (che contiene le impronte di ogni tabella e file) è firmato con HMAC-SHA256 (chiave derivata da `BACKUP_SIGNING_SECRET`, almeno 32 caratteri, **opzionale**) e la firma sta nella voce `manifest.sig` subito dopo `manifest.json`. `restoreArchive`/`pnpm backup:restore`: con il segreto impostato rifiuta un archivio **senza firma** (messaggio chiaro; si ammette solo con `--allow-unsigned`, per i backup vecchi) e **sempre** uno con firma errata o manifest alterato; rifiuta anche un secondo manifest o una seconda firma. Senza segreto l'archivio firmato si legge ma l'esito dice «firma presente ma non verificata». `--expect-sha256 <impronta>` confronta l'impronta del file cifrato (quella annotata fuori banda, nello storico dei backup) PRIMA di aprirlo. `pnpm doctor`: avviso `backup.signing` se i backup sono configurati ma manca il segreto. Formato: `formatVersion` resta 1; i backup esistenti (senza `manifest.sig`) restano leggibili. Prova: `tests/backup-signature.test.ts` (archivio manomesso, firma di un altro segreto, firma spostata o tolta, archivio vecchio con e senza `--allow-unsigned`, giro cifrato, `--expect-sha256`, variabile d'ambiente, doctor). Limiti: chi ruba **anche** `BACKUP_SIGNING_SECRET` (sta sul server) e la chiave pubblica può ancora fabbricare un backup: la firma protegge da chi ha solo accesso in scrittura alla cartella dei backup (lo scenario di F-06), non da una compromissione del server; il segreto vive nell'ambiente del server, quindi una firma con chiave del proprietario fuori dal server (Ed25519) resta un'evoluzione possibile. Non coperto: byte in coda dopo l'ultimo blocco cifrato. |
| F-07 | **Corretto** | `rule.ts`: `z.httpUrl(...)` al posto di `z.url(...)` per `sourceUrl` (unico uso nei moduli; `env.ts` usa `.url()` per configurazione, non per input utente). Prova: `tests/security-fixes.test.ts` (`javascript:` e `data:` rifiutati, `https:` accettato). |
| F-08 | **Corretto** | La regola morta è sostituita da `"/passkey/verify-authentication": { window: 60, max: 10 }` (percorso reale del plugin). Prova: `tests/security-fixes.test.ts` (controlla anche che il plugin installato definisca quel percorso). |
| F-09 | **Corretto in parte** | `frame-src 'self'` diventa `'none'` (nessun `<iframe>`, `<embed>` o `<object>` in `src`, l'anteprima PDF è una scheda): gli e2e di documenti restano verdi. CORP era già presente. Non toccato `style-src-attr 'unsafe-inline'`: serve agli stili inline dei componenti, toglierlo non è sicuro senza un lavoro dedicato. |
| F-10 | **Corretto in parte** | (1) `unzipStream` ha tetti di lettura: voce decompressa ≤ 1 GiB, totale ≤ 8 GiB, rapporto di espansione ≤ 1000 (controllato solo oltre 64 MiB decompressi, per non penalizzare i testi ripetitivi); configurabili con il secondo argomento (`ZipLimits`), con `limits` in `restoreFromArchive` e con `--max-bytes` in `pnpm backup:restore`; prova in `tests/backup-signature.test.ts`. (2) CSV: `shared/csv.ts` neutralizza anche le celle che iniziano con spazi o tabulazioni e poi `=`, `+`, `-`, `@` (un testo legittimo come «Rossi», «a = b», «via Roma 1 - Milano» non cambia); prova in `tests/csv.test.ts`. (3) Azioni GitHub: `ci.yml` e `security.yml` fissate per hash di commit con il tag in commento (hash letti da `git ls-remote` su GitHub: `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `pnpm/action-setup`); Dependabot le aggiorna. Mai eseguite (nessuna CI girata dopo la modifica). **Non fatto**: estrazione del PDF in un worker con `terminate()`, esportazione/ricerca in memoria (accettati, E54), byte in coda ai backup cifrati. |
| N-01 | **Corretto** (2026-10-08) | Trovato dalla revisione del 2026-10-08: `/two-factor/get-totp-uri` e `/two-factor/disable` bastavano sessione e password e aggiravano la riconferma di F-04 (segreto TOTP in chiaro, o secondo fattore spento). Aggiunte a `PASSWORD_GATED_PATHS` (`auth.ts`); l'app non le usa. Prova: `tests/security-fixes.test.ts` ed `e2e/security-fixes.spec.ts` (403). **Ancora aperti**: registrazione di una passkey da cookie rubato entro 10 minuti dalla sessione (non verificata), e `tests/authz.test.ts` che non copre `(auth)/sicurezza/configurazione`. |

### Note di realizzazione (F-04, F-06, F-10)

I disegni proposti in origine (colonna nella sessione per F-04; chiave Ed25519 fuori dal server per F-06) sono stati sostituiti da varianti **senza schema**, perché il compito vietava migrazioni: cookie firmato legato alla sessione per F-04, HMAC con segreto di server per F-06. Il costo è dichiarato nelle righe della tabella (limiti). Resta valida l'ipotesi più forte per F-06: una firma con chiave privata del proprietario, applicata fuori dal server, proteggerebbe anche da una compromissione del server.

---

## Indice

1. [Problemi trovati, per gravità](#1-problemi-trovati-per-gravità)
   - F-01 Media — la verifica dell'utente (biometria/PIN) della passkey non è imposta dal server
   - F-02 Media (dipende dall'hosting) — limite di frequenza basato su `x-real-ip`
   - F-03 Bassa — le azioni del server che chiamano `auth.api.*` non hanno limite di frequenza
   - F-04 Bassa — `freshAge` configurato ma mai preteso
   - F-05 Bassa — esportazione e scaricamenti raggiungibili con una navigazione GET da un altro sito
   - F-06 Bassa (plausibile) — i backup non sono autenticati: chi ha la chiave pubblica può fabbricarne uno valido
   - F-07 Informativa — `z.url()` accetta `javascript:` e `data:` (neutralizzato)
   - F-08 Informativa — regola di frequenza `/sign-in/passkey` inesistente
   - F-09 Informativa — CSP e intestazioni: lacune minori
   - F-10 Informativa — altri limiti e rischi di disponibilità
2. [Cosa è stato controllato e trovato corretto](#2-cosa-è-stato-controllato-e-trovato-corretto)
3. [Cosa NON è stato verificato](#3-cosa-non-è-stato-verificato)

---

## 1. Problemi trovati, per gravità

### F-01 — Media — CONFERMATO — la verifica dell'utente della passkey non è imposta al login

- **Dove**: `app/src/platform/auth/auth.ts` (righe ~66–72, opzione `authenticatorSelection`), `app/node_modules/@better-auth/passkey/dist/index.mjs` (righe ~179, 278, 355, 483).
- **Evidenza**: l'app imposta `authenticatorSelection: { residentKey: "required", userVerification: "required" }` e il commento dice «la passkey da sola vale come due fattori». Nel plugin installato `authenticatorSelection` è usato **solo** nelle opzioni di *registrazione*; le opzioni di *autenticazione* (`generate-authenticate-options`) hanno `userVerification: "preferred"` fisso, e sia la verifica della registrazione sia quella dell'autenticazione chiamano `verifyRegistrationResponse/verifyAuthenticationResponse` con `requireUserVerification: false`. L'app non imposta il gancio `authentication.afterVerification` che permetterebbe di controllare il flag UV.
- **Scenario**: chi ruba (o ha qualche minuto di accesso fisico a) un autenticatore che accetta la sola presenza (chiave di sicurezza senza PIN, o un client/estensione che non esegue la verifica) può entrare con la sola passkey: la passkey **salta il TOTP** per progetto, quindi il secondo fattore non esiste. Con piattaforme (Windows Hello, Touch ID, Android) il dispositivo di norma chiede comunque la biometria con «preferred», quindi nel caso tipico l'effetto pratico è piccolo; ma la proprietà dichiarata («passkey = due fattori») **non è garantita dal server**.
- **Correzione minima**: in `passkey({ ... authentication: { afterVerification: ({ verification }) => { if (!verification.authenticationInfo.userVerified) throw new APIError("UNAUTHORIZED", ...) } } })` (e analogo controllo in registrazione), oppure correggere il commento e la documentazione dicendo che la passkey è un fattore di possesso. Non ho potuto provare la firma esatta del gancio in esecuzione: da verificare con un test e2e che rifiuti un'asserzione senza UV.

### F-02 — Media se l'app non sta dietro Vercel; Bassa su Vercel — CONFERMATO nel codice, ambiente NON verificato — limite di frequenza e `x-real-ip`

- **Dove**: `app/src/platform/auth/auth.ts` (`advanced.ipAddress.ipAddressHeaders: ["x-real-ip"]`, `rateLimit.customRules`); logica in `better-auth/dist/api/rate-limiter/index.mjs` e `@better-auth/core/dist/utils/ip.mjs`. È la decisione E7 («da riconfermare al primo deploy»).
- **Evidenza**: la chiave del contatore è `<ip>|<percorso>` e l'IP è letto dall'intestazione `x-real-ip` così com'è, senza liste di proxy fidati. Due effetti, entrambi dal codice:
  1. senza un proxy che **sovrascriva** `x-real-ip`, un client che cambia valore a ogni richiesta azzera il limite (5 accessi/minuto con password; 5 tentativi/minuto per `/two-factor/*`);
  2. se l'intestazione manca, tutte le richieste cadono in un unico bucket condiviso `no-trusted-ip` per percorso: chiunque può esaurire i 5/minuto di `/sign-in/email` e impedire l'accesso con password al proprietario (non quello con passkey).
- **Scenario**: `next start` esposto direttamente o dietro un reverse proxy che non riscrive l'intestazione (Docker, VPS). L'attaccante prova password all'infinito. **Mitigazioni reali presenti**: serve poi il TOTP, e il blocco per account (10 errori → 15 minuti, `twoFactor.accountLockout`, verificato in `verify-two-factor.mjs`) non dipende dall'IP; l'accesso con passkey non è colpito. Quindi non porta a una compromissione da solo, ma toglie uno strato.
- **Su Vercel** la piattaforma imposta `x-real-ip` e non inoltra quello del client: non l'ho potuto verificare (nessun account), e la documentazione di Vercel è l'unica fonte.
- **Correzione minima**: documentare in `RUNBOOK.md` che l'app va distribuita solo dove il proxy riscrive `x-real-ip`; in alternativa usare `trustedProxies` con `x-forwarded-for`. Dopo il primo deploy, provarlo con `curl -H "x-real-ip: 1.2.3.4"` e controllare che il limite resti per il client reale.

### F-03 — Bassa — CONFERMATO nel codice — azioni del server che chiamano `auth.api.*` aggirano il limite di frequenza

- **Dove**: `app/src/app/(app)/impostazioni/sicurezza/actions.ts` (`changePasswordAction`, `regenerateRecoveryCodesAction`); il limite è applicato solo in `better-auth/dist/api/index.mjs` (riga ~172, gestore HTTP del router), non nelle chiamate dirette `auth.api.changePassword/generateBackupCodes`.
- **Scenario**: chi ha rubato un cookie di sessione (non la password) può usare queste azioni come **oracolo di password senza limite** (restituiscono `wrongPassword`), e con la password ottenere i nuovi codici di recupero o cambiare la password. Condizione: sessione già rubata (cookie `httpOnly`, quindi non via XSS: serve accesso al dispositivo o al traffico). Il TOTP non è richiesto per queste azioni.
- **Correzione minima**: contatore di tentativi falliti per proprietario (anche solo in `rate_limit`) nell'azione, oppure pretendere sessione fresca (vedi F-04) e un secondo fattore recente prima di mostrare codici di recupero.

### F-04 — Bassa — CONFERMATO — `freshAge` è configurato ma l'app non lo pretende mai

- **Dove**: `auth.ts` («Esportazioni, cancellazioni e condivisioni richiederanno una sessione "fresca»); `grep` su `src` non trova nessun uso di `freshSessionMiddleware`/controllo di freschezza. Better Auth lo applica solo alle proprie rotte sensibili (aggiunta passkey: sì, verificato).
- **Scenario**: una sessione di 7 giorni (rinnovata ogni giorno) basta a scaricare l'**esportazione completa in chiaro** (`/api/esportazione`: dati fiscali, rubrica di terzi, tutti i file), i backup cifrati, i pacchetti di condivisione, cambiare password. Il modello «un'app personale dietro passkey» tollera il rischio di una sessione rubata solo se i dati più sensibili hanno una barriera in più; qui non c'è.
- **Correzione minima**: in `getOwnerForApi()`/`requireOwner({ fresh: true })` confrontare `session.createdAt`/`updatedAt` con `freshAge` per `/api/esportazione`, `/api/backup/[id]`, `/api/condivisione/[id]` e le azioni di sicurezza, reindirizzando a un nuovo accesso.

### F-05 — Bassa — CONFERMATO — scaricamenti con effetti collaterali raggiungibili con GET cross-site

- **Dove**: `app/src/app/api/esportazione/route.ts` (genera l'intera esportazione e scrive una riga di audit `backup.export`); `api/condivisione/[id]/route.ts` (registra `share.download` e revoca/log); cookie di sessione `SameSite=Lax` (default di Better Auth, verificato in `cookies/index.mjs`).
- **Scenario**: un sito malevolo fa una navigazione di primo livello (`location = "https://app/api/esportazione"`): il cookie Lax viene inviato, l'app prepara tutto e il browser **salva un file con tutti i dati in chiaro nella cartella Download** del proprietario; l'attaccante non può leggerlo, ma lascia dati personali non cifrati su disco e può causare carico (memoria: l'archivio si costruisce da tutte le tabelle). Per la condivisione serve l'UUID del pacchetto (non indovinabile): trascurabile.
- **Correzione minima**: nelle rotte che cambiano stato o producono file riservati rifiutare se `Sec-Fetch-Site` non è `same-origin` o `none` (e, in assenza dell'intestazione, `Origin`/`Referer` diversi).

### F-06 — Bassa — PLAUSIBILE — i backup sono riservati ma non autenticati

- **Dove**: `app/src/shared/archive/crypto.ts`, `app/src/modules/backup/application/restore.ts`, `postgres-snapshot.ts`.
- **Evidenza**: la cifratura usa solo la chiave **pubblica**; l'integrità dei blocchi è autenticata con una chiave dati scelta da chi cifra. Chiunque abbia `BACKUP_PUBLIC_KEY` può quindi produrre un `.gibk` valido. Il manifest ha solo impronte SHA-256 (nessuna firma) e la catena dell'audit non ha chiave (si può ricalcolare). L'archivio del backup include le tabelle `user`, `account`, `passkey`, `two_factor`.
- **Scenario**: chi ha **scrittura sulla cartella/destinazione dei backup** (disco condiviso, bucket, sincronizzazione) sostituisce un backup con uno fabbricato che contiene un proprio utente/password/passkey; il proprietario, in un ripristino di emergenza su un ambiente vuoto, installa le credenziali dell'attaccante. Richiede che il ripristino avvenga davvero e che l'attaccante abbia quel permesso: per questo è solo plausibile.
- **Correzione minima**: firmare il manifest (o l'intero flusso) con una chiave di firma tenuta fuori dal server — o, più semplice, annotare fuori banda l'impronta SHA-256 di ogni backup (già calcolata in `backup_run.archive_sha256`) e fare confrontare al comando di ripristino. Nota a margine, non sfruttabile da solo: la lettura del ZIP (`unzipStream`) accumula in memoria ogni voce senza tetto di dimensione (bomba di compressione contro il comando di ripristino, eseguito solo a mano dal proprietario su un archivio già autenticato dal GCM), e dopo l'ultimo blocco i byte aggiunti in coda sono ignorati.

### F-07 — Informativa — CONFERMATO — `z.url()` accetta schemi pericolosi

- **Dove**: `app/src/modules/rules/domain/rule.ts:70` (`sourceUrl: z.url(...)`), reso come `<a href={current.sourceUrl} target="_blank">` in `regole/[id]/page.tsx:93`.
- **Prova eseguita**: `z.url().safeParse("javascript:alert(1)")` e `"data:text/html,<script>"` → `success: true`; `renderToString(<a href="javascript:...">)` con React 19.2.8 → l'attributo viene **sostituito** da `javascript:throw new Error('React has blocked a javascript: URL…')`. In più la CSP (`script-src` con nonce, niente `unsafe-inline`) bloccherebbe comunque l'esecuzione. Solo il proprietario inserisce il valore. Nessun danno oggi.
- **Correzione minima**: `z.httpUrl()` (o `refine` su `http:`/`https:`): difesa in profondità.

### F-08 — Informativa — CONFERMATO — regola di frequenza `/sign-in/passkey` morta

- **Dove**: `auth.ts` `customRules["/sign-in/passkey"]`. Il plugin passkey non espone quel percorso (cerca `sign-in/passkey` nel plugin: nessuna occorrenza; i percorsi reali sono `/passkey/generate-authenticate-options` e `/passkey/verify-authentication`), quindi valgono 60 richieste/minuto globali. Nessun rischio pratico (un'asserzione WebAuthn non si indovina), ma la configurazione dà una sensazione di controllo che non c'è. Correzione: usare `"/passkey/*"` o toglierla.

### F-09 — Informativa — CSP e intestazioni

Letti `src/proxy.ts` e `next.config.ts`. Corretti: nonce per richiesta (UUID v4), `strict-dynamic`, niente `unsafe-inline` per script e `<style>` in produzione, `object-src 'none'`, `base-uri`, `form-action 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, HSTS, COOP, Referrer-Policy, Permissions-Policy. Lacune minori, nessuna sfruttabile oggi:
- `style-src-attr 'unsafe-inline'` consente stili inline in attributo: servirebbe una iniezione HTML, che non esiste (nessun `dangerouslySetInnerHTML` tranne lo script del tema con testo costante). Rischio solo di esfiltrazione CSS in caso di una futura iniezione.
- `frame-src 'self'` non serve: non ci sono `<iframe>`/`<embed>` (verificato con grep; l'anteprima PDF è una nuova scheda, E19) e le pagine non sono incorniciabili. Si può stringere a `'none'`.
- Manca `Cross-Origin-Resource-Policy: same-origin` sulle rotte `/api/*` (i file sono comunque dietro sessione e non leggibili cross-origin, nessun CORS configurato).
- Le rotte dei file ereditano la CSP di pagina; per PDF/immagini serviti in linea (`image/*`, `application/pdf` con `nosniff`) non c'è rischio di esecuzione: ho provato che SVG e HTML non passano `sniffFile` (vedi sezione 2).

### F-10 — Informativa — altri limiti

- **Disponibilità (tutto richiede la sessione del proprietario)**: la ricerca globale `/cerca` e l'esportazione leggono tutte le tabelle in memoria (accettato in E54); l'estrazione del testo PDF in processo usa `Promise.race` con tetto di 20 s che **non ferma** il lavoro della CPU (`modules/documents/application/use-cases.ts`): un PDF ostile ricevuto da terzi e archiviato dal proprietario può occupare il processo; pdf.js è la 6.1 (successiva a CVE-2024-4367) e la build serverless non usa `eval`.
- **Segreto di avvio**: `bootstrapAction` non ha limite di frequenza (le server action non passano dal limitatore), ma il token ha ≥32 caratteri e il confronto è a tempo costante: non attaccabile. Resta che `OWNER_BOOTSTRAP_TOKEN` dopo il primo accesso è inutile ma va tolto dall'ambiente (già scritto in `.env.example`); lo ricordo perché la procedura «accesso perso» del RUNBOOK lo riattiva.
- **Registro di audit**: salva `ipAddress` e `userAgent` della sessione; l'IP viene da `x-real-ip` (falsificabile se F-02) e lo user agent non ha tetto (solo sessioni già autenticate). Non è una fuga.
- **Log**: Next stampa comunque l'errore completo sullo stderr di produzione (lo ammette `instrumentation.ts`): le pagine di errore mostrano solo il `digest`; verificato.
- **CI**: le azioni GitHub sono fissate per tag (`@v4`), non per hash di commit; `permissions` dichiarate. Rischio di catena di fornitura minimo, dependabot attivo.
- **CSV**: la neutralizzazione delle formule copre `= + - @ \t \r`; una cella che inizia con spazio e poi `=` non viene modificata (prova eseguita: `" =1"` resta tale). Excel/LibreOffice di norma non valutano una formula preceduta da spazio, ma non l'ho verificato con un foglio di calcolo reale.
- **Ripristino**: `restoreArchive` accetta qualunque chiave di storage valida (`assertSafeKey`), non solo `documents/…`: sovrascrive file solo in ambiente vuoto e su un archivio già autenticato.

---

## 2. Cosa è stato controllato e trovato corretto

**Controllo accessi**
- Ogni funzione esportata di ogni `actions.ts` con `"use server"` passa da `requireOwner`/`ownerAction*` (scansione automatica mia: le uniche «senza» sono wrapper che delegano a una funzione protetta e `bootstrapAction`, pubblica per progetto ma protetta dal token e da `ownerExists()`).
- Tutte le route `/api/*` rispondono 401 senza sessione, tranne `auth` (Better Auth), `cron/*` (segreto) e `health` (volutamente povera). `getOwnerForApi()` esige anche TOTP+passkey configurati.
- Tutte le pagine con parametro dinamico `[id]` validano con `isUuid` (nessuna senza controllo); non ci sono parametri di percorso usati in query senza validazione.
- Cron: `Authorization: Bearer <CRON_SECRET>` con `timingSafeEqual`; chiuso se il segreto manca (confronto di lunghezza prima: perdita di lunghezza irrilevante).
- Nessun open redirect: tutti i `redirect()` usano percorsi costruiti dal server con UUID.

**File**
- `sniffFile` decide dai byte: provato che SVG, HTML con estensione `.png` e HTML grezzo vengono **rifiutati**; un poliglotta `%PDF-…<script>` è servito come `application/pdf`, un `GIF89a…<script>` come `image/gif`, entrambi con `X-Content-Type-Options: nosniff` e `Content-Disposition` coerente: nessun XSS da file caricati. In linea solo PDF/PNG/JPEG/GIF/WebP; tutto il resto (TIFF, docx, p7m…) `attachment`.
- Nome file ostile: `Content-Disposition` usa versione ASCII ripulita (`[^\x20-\x7e]|["\\]` → `_`) più `filename*=UTF-8''` con `encodeURIComponent`: nessuna iniezione di intestazione. `safeFileName` per i ZIP: provati `..\..\x.pdf`, `a\r\nb.pdf`, `../../a`, RLO → risultati innocui.
- `LocalFileStorage`: chiavi generate dall'app (`documents/<uuid>`), `assertSafeKey` rifiuta `..`, `/`, `\`, maiuscole, spazi (provato), più controllo `startsWith(root + sep)`. Backup: chiave `^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$`.
- Limite di 25 MB e `bodySizeLimit` 26 MB per le azioni; ZIP di condivisione generato a flusso con verifica SHA-256 per file; HTML dell'indice con `escapeHtml` su ogni campo e senza script; CSV con neutralizzazione formule (`alwaysQuote`).
- Ripristino: nomi di voce con `..`, percorsi assoluti o `\` rifiutati; nome tabella dentro un elenco chiuso (`assertKnownTable`); dati inseriti come **parametro** `::json` (nessuna concatenazione SQL).

**Backup e cifratura (provato in esecuzione su 3 MB, `crypto.ts`)**
- Chiave dati casuale a 32 byte per backup + nonce base di 8 byte casuali + contatore a 32 bit: nessun riuso di coppia (chiave, nonce); nonce base diverso tra due cifrature (provato).
- Intestazione, contatore e flag «ultimo» entrano nell'AAD: **troncamento dell'ultimo blocco** → errore; **blocco tolto** → errore; **blocchi scambiati** → errore; **bit cambiato** → errore; **intestazione/nonce alterati** → errore (tutti provati). RSA-OAEP-SHA256, modulo 3072 bit. Dati in coda dopo l'ultimo blocco accettati (F-06, nota).
- Chiave privata mai sul server; `backup-keygen` scrive con `wx` e modo 0600. `/api/backup/[id]`: sessione, UUID, stato, nome da `destinationKey` (formato fisso), resta cifrato.

**Autenticazione**
- Registrazione pubblica spenta; un solo utente imposto da indice univoco e gancio; token di avvio confrontato con SHA-256 + `timingSafeEqual`; password 12–128; nessun ripristino password via email (nessun invio configurato: niente account takeover da email); cookie `httpOnly`, `SameSite=Lax`, `Secure` quando `BETTER_AUTH_URL` è https, cache di sessione nel cookie disattivata (revoca immediata); durata 7 giorni.
- TOTP: blocco per account a 10 errori / 15 minuti (non dipende dall'IP), `trustDevice: false` nei client; aggiunta di passkey richiede sessione fresca (`freshSessionMiddleware`, verificato); `rpID`/`origin` derivati da `BETTER_AUTH_URL`; ultima passkey non rimovibile (con `for update`). Enumerazione account: un solo utente, `sign-in/email` risponde in modo uniforme.
- Controllo di `Origin` di Better Auth attivo (non c'è `disableCSRFCheck`); server action protette dal controllo Origin/Host di Next.

**Iniezioni**
- Nessun `sql.raw` con dati utente (gli unici sono in `postgres-snapshot.ts` con nomi di tabella/colonne ricavati dal catalogo e da un elenco chiuso), nessun `sql.identifier`. Tutti gli `ILIKE` passano da `escapeLike` (`\ % _`); `websearch_to_tsquery` con parametro. Ordinamenti non controllati dall'utente.
- Email Resend: corpo JSON con `to` come array e testo semplice: nessuna iniezione di intestazioni. ICS: escape RFC 5545, caratteri di controllo tolti, URL privato di spazi/controlli. Nessun `JSON.parse` su input utente fuori dal ripristino (che valida con zod); nessuna scrittura di chiavi dinamiche su oggetti.
- XSS: nessun `dangerouslySetInnerHTML` oltre allo script costante del tema (con nonce); testo utente reso da React; `rel="noopener"` sui link `_blank`.

**Fughe e segreti**
- Pagine d'errore mostrano solo `digest`; `request-error.ts` logga solo campi a lista bianca; `/api/health` non espone nulla; nessun `NEXT_PUBLIC_*` nel progetto; messaggi di errore dei cron esposti solo dietro segreto.
- Ricerca di segreti in tutto `D:\casa` (esclusi `node_modules`, `.next`, `.pglite`, `.storage`, `.env.local`): nessuna chiave privata, token API, chiave AWS o URL di database con credenziali reali; solo credenziali di prova (`postgres:postgres` locale, segreti e2e dichiarati «solo per i test»). `.gitignore` (radice e `app`) copre `.env*`, `backups/`, `*.pem`, `*.gibk`, `.pglite/`, `/.storage/`, `e2e/.auth/`, `test-results/`; verificato con `git check-ignore`.

**Dipendenze usate in modo rischioso**: nessuno trovato (pdf.js 6.1 senza `eval`; `fflate` solo per ZIP prodotti/letti dal proprietario; `pnpm audit` già in CI, non rifatto).

---

## 3. Cosa NON è stato verificato

- Il comportamento di `x-real-ip` su Vercel e di qualunque altro ambiente reale; i cron di Vercel; Neon con TLS (la `sslmode` dipende dalla stringa di connessione; il codice non forza TLS).
- Il gancio `afterVerification` di F-01 non è stato eseguito (nessun autenticatore virtuale usato); la mia valutazione si basa sul codice del plugin installato.
- Nessun test dinamico contro un server in esecuzione (porta 3000 dell'utente e database locale non toccati; la build di produzione e gli e2e non sono stati lanciati da me).
- Il database: trigger di append-only dell'audit, permessi del ruolo del database (l'app si collega con un solo ruolo che possiede le tabelle: chi compromette l'app può anche disattivare i trigger di audit; è nel modello di rischio, non un difetto del codice).
- Comportamento di un foglio di calcolo reale con celle che iniziano con spazio e `=`.

Nota: il messaggio del coordinatore sulla migrazione «0014» non riguarda questo incarico (nessuna migrazione né modifica allo schema creata da me).
