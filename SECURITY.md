# Sicurezza

«Gestione Immobili» è un'app **personale**, per un solo proprietario: contiene documenti, dati catastali, importi e rubrica di una persona. Questo documento dice contro cosa è stata pensata, cosa è protetto e come, e — con la stessa chiarezza — cosa **non** lo è o non è stato provato. Ciò che è scritto come protetto è stato riscontrato sul codice o su un test; dove non è così, è detto.

Per le procedure (backup, ripristino, accesso perso, segreti) vedi [`docs/RUNBOOK.md`](docs/RUNBOOK.md); per com'è fatto il sistema [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); per le scelte [`DECISIONS.md`](DECISIONS.md).

## 1. Modello di minaccia in breve

**Cosa si vuole proteggere**: la riservatezza di documenti e dati (titoli, catasto, contratti, polizze, pagamenti), l'integrità dei dati e della loro cronologia, la disponibilità dei dati (backup che si possono riaprire) e la sola persona autorizzata ad accedere.

**Da chi**:

- Chi trova l'indirizzo dell'app su Internet e prova ad entrare (indovinare password, provare le rotte, la registrazione).
- Chi ruba una password o un dispositivo (la passkey con verifica dell'utente e il secondo fattore servono a questo).
- Chi legge una copia dei dati che non dovrebbe leggere: un backup rubato, un database copiato, un file esportato.
- Un errore del programmatore (una pagina nuova che dimentica il controllo accessi, un CSV che esegue formule, un messaggio di errore che mostra dati): per questo molti controlli sono **test automatici sul codice**.
- Il proprietario stesso che sbaglia: per questo l'audit e i backup.

**Fuori dal modello** (non è stato progettato per resistere a): un attaccante con accesso amministrativo al database o al server (può disattivare i trigger e leggere la memoria); la compromissione del dispositivo del proprietario; l'indisponibilità dei fornitori; più utenti (non esistono: l'app ammette un solo account).

## 2. Cosa è protetto e come

### Accesso

- **Un solo account**, garantito dal database (indice univoco `user_single_owner`) e dal codice. La registrazione pubblica è spenta; l'account si crea con un token monouso (`OWNER_BOOTSTRAP_TOKEN`, confronto a tempo costante, valido solo finché non esiste un utente). Dopo la configurazione il token va rimosso dall'ambiente.
- **Passkey** con verifica dell'utente obbligatoria (biometria o PIN) come accesso principale; **password** (12–128 caratteri) **più TOTP** o un codice di recupero come via di riserva. Per usare l'app servono TOTP attivo e almeno una passkey. Dopo 10 secondi fattori sbagliati l'account si blocca per 15 minuti.
- **Limite di frequenza** nel database (non in memoria), per indirizzo: ad esempio 5 tentativi al minuto sulla password, 5 sul secondo fattore. Provato con un test e2e (risposta 429).
- **Sessione**: 7 giorni, nessuna cache nel cookie (una sessione revocata smette di valere subito). Il cookie di sessione è `HttpOnly` e `SameSite=Lax` (verificato in `e2e/auth.spec.ts`) e `Secure` quando l'app è servita in HTTPS (`useSecureCookies` dipende da `BETTER_AUTH_URL`; in HTTPS **non provato** su un dominio reale).

### Controllo degli accessi e il test che lo impone

Il controllo non sta solo nel proxy o nel layout (che sono ottimistici): **ogni pagina, ogni azione del server e ogni route HTTP lo ripete al livello dei dati** (`requireOwner()`, `getOwnerForApi()`). `app/tests/authz.test.ts` cammina sui sorgenti e **fallisce** se una pagina dell'area riservata, una route o un'azione non lo chiama, se compare una pagina pubblica nuova, o se un file `"use server"` esporta qualcosa che non sia una funzione async (Next la renderebbe un endpoint). Le uniche eccezioni sono un elenco chiuso: pagine di accesso e configurazione, l'azione di avvio, `/api/auth/*`, `/api/cron/*` (segreto) e `/api/health`. Quest'ultima è pubblica di proposito, ammessa dal test solo se non legge dati dai moduli e non mostra il motivo di un errore. Senza sessione le route rispondono 401; le pagine reindirizzano all'accesso. Elenco completo e codici: [`docs/API.md`](docs/API.md).

Un test statico (`tests/client-boundary.test.ts`) vieta inoltre che il codice del browser importi database, moduli o `process.env`: i segreti non entrano nel bundle client.

### Intestazioni e CSP a nonce

Il proxy (`app/src/proxy.ts`) imposta per ogni richiesta una **Content-Security-Policy con nonce** diverso: `script-src 'self' 'nonce-…' 'strict-dynamic'` (nessun `unsafe-inline` né `unsafe-eval` per gli script in produzione), `style-src` con nonce, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src 'self'`. Gli altri header sono in `app/next.config.ts`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microfono, geolocalizzazione, pagamenti, USB vietati), `Strict-Transport-Security` (due anni, sottodomini inclusi), `Cross-Origin-Opener-Policy: same-origin`; `X-Powered-By` è tolto. Gli e2e sulla **build di produzione** verificano che il nonce cambi a ogni richiesta, che non compaia `unsafe-eval` né `unsafe-inline` per gli script e che le pagine non producano violazioni CSP. Un'eccezione dichiarata: `style-src-attr 'unsafe-inline'` (i componenti shadcn scrivono variabili CSS in attributi `style`; non eseguono script). In `next dev` la CSP è più larga (E10): non è la configurazione di produzione.

### Documenti e download

I file si aprono solo da `/api/documenti/<id>/<versione>` con la sessione (mai URL pubblici), con `nosniff` e `Cache-Control: private, no-store`. Il tipo di file è riconosciuto dai **byte** (non dall'estensione dichiarata) e un tipo non ammesso è rifiutato (E20). Le chiavi dello storage sono validate (niente `..`, niente percorsi assoluti). Un archivio ZIP con percorsi pericolosi è rifiutato in lettura (`tests/backup.test.ts`).

### Catena di audit e suoi limiti

Ogni scrittura registra una riga in `audit_log` nella **stessa transazione**, con un hash che incatena la riga alla precedente, calcolato **da un trigger del database** (nessun percorso applicativo può aggirarlo); un secondo trigger vieta modifica, cancellazione e `TRUNCATE`. L'audit registra solo **nomi** di azioni e di campi, identificativi e conteggi, **mai valori**. «Verifica ora» (`/impostazioni/registro`) ricalcola la catena.

Limiti, che il programma stesso dichiara: rende **evidente**, non impossibile, una manomissione; chi è proprietario del database può disattivare i trigger; la **rimozione delle ultime righe** emerge solo confrontando l'hash di testa con una copia esterna (l'archivio dei backup e l'elenco dei backup in Impostazioni la riportano); l'esito «nessuna anomalia» non è una garanzia di integrità. La concorrenza della catena è provata davvero solo su un Postgres reale, non su PGlite (E3).

### Cifratura dei backup

Il backup è un archivio ZIP **cifrato con la chiave pubblica** del proprietario (AES-256-GCM a blocchi, chiave dati avvolta con RSA-OAEP-SHA256, RSA 3072). La chiave **privata** non sta mai sul server e non si può recuperare: chi ruba il server o la cartella dei backup **non può leggerli**; un blocco tolto, spostato o un file troncato fanno fallire la lettura (test in `tests/backup.test.ts`). Il ripristino verifica le impronte di ogni tabella e di ogni file e la catena dell'audit prima di fidarsi. Con `BACKUP_SIGNING_SECRET` impostato il manifest è anche **firmato** (HMAC-SHA256) e il ripristino rifiuta un archivio senza firma o con firma errata (`--allow-unsigned` solo per i backup vecchi; `--expect-sha256` confronta l'impronta annotata fuori banda): protegge da chi può solo scrivere nella cartella dei backup, **non** da chi controlla il server (il segreto sta lì). Senza il segreto i backup non sono autenticati. La lettura dell'archivio ha tetti di dimensione e di rapporto di espansione. L'**esportazione completa** è invece **in chiaro** (serve a non restare vincolati all'app) ma senza credenziali (`user`, `account`, `passkey`, `two_factor`): va custodita come un documento riservato.

### CSV e calendario a prova di iniezione

- **CSV** (`app/src/shared/csv.ts`, usato da riepilogo dei tributi, quadro economico e indice dei pacchetti di condivisione): una cella che inizia con `=`, `+`, `-`, `@`, tabulazione o ritorno a capo (anche dopo spazi o tabulazioni iniziali) riceve un apice davanti, perché aprendo il file in un foglio di calcolo non venga eseguita come formula. Un difetto trovato su questo punto (indice CSV dei pacchetti, che parte verso terzi) è stato corretto (E51). Test: `tests/csv.test.ts`.
- **Calendario `.ics`** (`app/src/shared/ics.ts`): escape secondo RFC 5545, righe piegate a 75 byte senza spezzare caratteri UTF-8, e un URL non può aggiungere proprietà al file (E55). Test: `tests/ics.test.ts`. Il file **contiene titoli e nomi degli immobili**: a chi lo importa in un calendario condiviso arrivano gli stessi dati.

### Pagine di errore

Un errore mostra **solo il codice `digest`** con cui si ritrova nei log, mai il messaggio (potrebbe contenere dati personali). Lo verifica `tests/problem-pages.test.ts` con un messaggio che contiene un codice fiscale.

### Gestione dei segreti

- Le variabili sono validate al primo uso (`app/src/platform/config/env.ts`); negli errori compaiono **solo i nomi**, mai i valori.
- `.env*` (tranne `.env.example`), `.pglite/`, `.storage/`, `backups/`, `*.pem` e `*.gibk` sono in `.gitignore`. Non esistono credenziali di terzi nell'app (SPID, Entratel, portali): non si memorizzano.
- `BETTER_AUTH_SECRET` (almeno 32 caratteri), `OWNER_BOOTSTRAP_TOKEN` (da rimuovere dopo l'avvio), `CRON_SECRET` (almeno 16 caratteri; le route del cron sono chiuse senza e confrontano il segreto a tempo costante), `BACKUP_PUBLIC_KEY` (pubblica), `RESEND_API_KEY`: sul server, mai nel codice. La chiave **privata** dei backup resta fuori dal server.
- Gli e2e usano segreti di prova dichiarati come tali (`app/e2e/support/env.ts`); lo stato di sessione dei test sta in `app/e2e/.auth/`, ignorato da git.
- Dipendenze: Dependabot propone gli aggiornamenti ogni lunedì e un flusso settimanale esegue `pnpm audit --prod --audit-level high` (`.github/`). Una sola vulnerabilità nota è esclusa in `app/package.json` (`ignoreGhsas`), con il motivo in `DECISIONS.md` (E58). **Questi flussi non sono mai girati**: non c'è ancora un repository remoto.

### Linguaggio neutro come misura di sicurezza dell'informazione

L'app non dichiara mai che un immobile sia conforme o un tributo non dovuto: un'affermazione sbagliata dell'app avrebbe conseguenze reali per chi si fida. Il controllo è automatico (`tests/neutral-language.test.ts`); vedi [`CONTRIBUTING.md`](CONTRIBUTING.md).

## 3. Cosa NON è protetto o non è provato

- **Nessun deploy reale.** Mai provati su Vercel, Neon o un dominio reale: i cron, le email degli avvisi (Resend), le passkey sul dominio di produzione, la pipeline CI, il comportamento di `x-real-ip` (da cui dipende il limite di frequenza: su Vercel è impostato dalla piattaforma, da riconfermare al primo deploy, E7).
- **Nessuna verifica esterna.** Non c'è stato un penetration test né una revisione di sicurezza indipendente. I controlli automatici sono quelli elencati sopra e non sono una prova di assenza di difetti.
- **Documenti non cifrati dall'applicazione.** Nella v1 i file stanno sullo storage così come sono (D5): chi legge il disco o lo storage legge i documenti. Oggi lo storage è una cartella locale (`.storage/`); non c'è un adattatore per Vercel Blob o S3.
- **I backup sulla stessa macchina non sono una seconda copia.** La destinazione è una cartella su disco; un secondo fornitore non c'è (E24). Se perdi la chiave privata, nessun backup si riapre.
- **Audit non a prova di amministratore del database** (vedi sopra) e **non** provato in concorrenza su un Postgres reale (la CI non è mai girata).
- **Riconferma recente solo per alcune operazioni.** L'esportazione completa, lo scarico dei backup e dei pacchetti e le azioni sensibili della pagina Sicurezza (rimozione passkey, chiusura sessioni, codici di recupero, cambio password) pretendono una riconferma negli ultimi 10 minuti (password + codice, oppure passkey): cookie firmato legato a utente e sessione, vedi `docs/SECURITY_REVIEW.md` (F-04) e `docs/RUNBOOK.md`. Non la pretendono le altre operazioni (per esempio cancellare dati o creare un pacchetto): chi ha una sessione aperta le può fare. Chi ruba la sessione **dopo** una riconferma ha ancora fino a 10 minuti.
- **Esportazione completa e pacchetti di condivisione sono dati in chiaro** che escono dall'app: l'esportazione contiene tutto tranne le credenziali; un pacchetto contiene i documenti scelti, entro il tetto di riservatezza. Da lì in poi la protezione è di chi li riceve. Il link di condivisione a scadenza (D7) **non esiste**: si condivide solo con pacchetti ZIP.
- **`/api/health` è pubblica**: dice solo se il database risponde (E57).
- **Accessibilità e privacy** sono controllate in modo automatico ma non da persone con tecnologie assistive: gli esiti di axe non sostituiscono una verifica manuale.
- **Un solo utente**: l'app non ha ruoli, deleghe né accessi per professionisti. Non è progettata per essere condivisa.

## 4. Come segnalare un problema

L'app è personale e non ha un servizio di segnalazione né un indirizzo dedicato. Se trovi un problema di sicurezza:

1. **Non aprire una segnalazione pubblica** con i dettagli di una vulnerabilità e **non allegare** dati reali, segreti, token, chiavi, documenti o backup.
2. Scrivi **direttamente al proprietario del progetto**, per il canale con cui l'hai ricevuto o ti è stato dato accesso al codice, descrivendo: cosa hai osservato, i passi per riprodurlo, quale parte (pagina, route, comando) e l'effetto che ritieni possibile. Dati di prova inventati bastano.
3. Dai al proprietario il tempo di capire e correggere prima di divulgare l'informazione.

Se **sei tu** il proprietario e sospetti una compromissione (accesso perso, segreto trapelato, riga dell'audit che non torna): [`docs/RUNBOOK.md`](docs/RUNBOOK.md) descrive cosa fare (cambiare i segreti, verificare il registro, ripristinare da un backup). Se un segreto è finito in un repository o in un log, **consideralo compromesso e sostituiscilo** (rigenerare un segreto è sempre possibile; ripubblicare un file no).
