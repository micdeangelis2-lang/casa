# Manuale operativo — Gestione Immobili

Per chi tiene in funzione l'app (il proprietario). Dice cosa fare di routine e cosa fare quando qualcosa non va.
Ogni procedura indica se è stata **provata** (in locale o nei test automatici) o **non provata** (serve l'account Vercel o Neon, che ancora non ci sono: vedi `DECISIONS.md`).

I comandi si lanciano da `app/` (`cd app`).

## 1. Routine

| Quando | Cosa | Dove |
|---|---|---|
| Ogni volta che carichi documenti importanti | Fai un backup e controlla che sia comparso nell'elenco | Impostazioni, Backup ed esportazione (oppure `pnpm backup:run`) |
| Una volta al mese | Copia l'ultimo archivio `.gibk` **fuori dal computer** | Cartella `backups/`. L'archivio è già cifrato: puoi metterlo ovunque |
| Una volta al mese | Verifica che l'archivio si apra: `pnpm backup:restore --archive <file.gibk> --key <privata.pem> --verify-only` | Non scrive nulla, anche su un ambiente in uso |
| Dopo ogni rilascio o ripristino, e una volta al mese | Lancia `pnpm doctor` e leggi gli ⚠ e gli ✖ | Vedi «La diagnosi» nel §2 |
| Una volta ogni tanto | Controlla il registro delle modifiche con «Verifica ora» | Impostazioni, Registro delle modifiche |
| Una volta a trimestre | Prova un ripristino completo su un ambiente vuoto (§3) | Un backup che non hai mai riaperto non è una garanzia |
| Quando arriva | Rivedi e fondi gli aggiornamenti delle dipendenze, **solo se la CI è verde** | Richieste di Dependabot (ogni lunedì) |

Il giro giornaliero (rivalutazione dei dossier, date delle scadenze, avvisi, email) parte da solo alle 05:00 UTC su Vercel. In locale si lancia dal pulsante in Impostazioni, Notifiche e email: è sicuro rifarlo più volte (non duplica nulla).

## 2. Monitoraggio

`GET /api/health` risponde **200** con `{"status":"ok"}` se il database risponde, **503** con `{"status":"error"}` se non risponde entro 3 secondi o dà errore. È pubblico di proposito, non legge dati e non rivela il motivo dell'errore.

Collega un servizio di controllo (UptimeRobot, Better Stack, quello di Vercel…) con un controllo HTTP ogni 5 minuti su `https://<tuo-dominio>/api/health`, atteso 200, e fatti mandare l'avviso per email. *Non provato* su un dominio reale.

Cosa **non** controlla: che il giro giornaliero sia partito, che le email arrivino, che la cartella dei documenti sia scrivibile, che i backup siano recenti. Per i backup guarda l'elenco in Impostazioni; per il giro giornaliero guarda la data dell'ultimo avviso generato.

### La diagnosi: `pnpm doctor`

Da `app/`: `pnpm doctor` (con `--prod` per applicare le regole di produzione: `pnpm doctor --prod`). Legge l'ambiente di `.env.local` e controlla in un colpo solo le cose che `/api/health` non vede.

**Quando lanciarlo**: dopo ogni rilascio (e dopo `pnpm db:migrate`), dopo ogni ripristino (§3), una volta al mese insieme alla verifica del backup, e ogni volta che qualcosa «non torna» prima di cercare altrove.

**Cosa controlla**: variabili obbligatorie valide (nei messaggi solo i nomi, mai i valori); `BETTER_AUTH_URL` solo origine (https in produzione); connessione al database e tempo di risposta; migrazioni applicate uguali a quelle di `drizzle/` e nessuna in più; esistenza del proprietario; `OWNER_BOOTSTRAP_TOKEN` ancora impostato; cartelle dei documenti e dei backup scrivibili (crea e cancella un file di prova); `BACKUP_PUBLIC_KEY` presente, PEM valida e **non privata**; età dell'ultimo backup riuscito (avviso oltre 7 giorni); catena del registro delle modifiche, con riga e impronta di testa da confrontare con quelle di un backup; `CRON_SECRET` (almeno 16 caratteri); email configurata o no.

**Gli esiti**:

| Simbolo | Significato | Effetto |
|---|---|---|
| ✔ | Controllo superato | — |
| ⚠ | Avviso: qualcosa da sistemare o da sapere (token ancora impostato, nessun backup recente, email non configurata, controllo non eseguibile perché il database non risponde) | Codice di uscita 0 |
| ✖ | Errore: l'installazione non è a posto (variabile non valida, database o migrazioni che non tornano, proprietario assente, catena del registro con anomalia, cartella non scrivibile, chiave privata al posto della pubblica) | Codice di uscita **1** |

Ogni riga con ⚠ o ✖ dice sotto (→) cosa fare. Le email sono sempre solo un avviso informativo; `CRON_SECRET` mancante è un avviso in locale e un errore con `--prod`.

*Provato*: la logica con i test automatici (`tests/doctor.test.ts`) e lo script contro un database PGlite temporaneo (variabili giuste, database spento, variabili assenti). *Non provato*: contro Neon e contro un ambiente Vercel. Il controllo delle migrazioni confronta le date del giornale di `drizzle/` con quelle registrate da Drizzle: rileva migrazioni mancanti o in più, non una migrazione modificata a mano dopo l'applicazione. Non sostituisce `/api/health` né un controllo esterno.

### Leggere i log degli errori

Ogni errore del server (pagina, route, azione) scrive su stderr **una riga JSON** (da `src/instrumentation.ts`):

```
{"level":"error","time":"2026-10-06T10:00:00.000Z","digest":"1234567890","route":"/immobili/[id]","method":"GET","routeType":"render","errorName":"DrizzleQueryError","code":"23505"}
```

- `digest`: **lo stesso codice** che la pagina «Qualcosa non ha funzionato» mostra all'utente come «Codice dell'errore». `route` è il modello della route (mai l'indirizzo vero); `routeType` è `render`, `route`, `action` o `proxy`; `errorName` il tipo di errore; `code` (solo se c'è) il codice SQLSTATE di Postgres (per esempio `23505` violazione di unicità, `28P01` password rifiutata, `57014` interrotta per tempo).
- La riga **non contiene mai** messaggio, stack, corpo, intestazioni, query string o parametri SQL: potrebbero essere dati personali. Un test (`tests/request-error-log.test.ts`) lo verifica con messaggi con email, errori di Drizzle con parametri e cause annidate.
- Può mancare il `digest` (`null`) per errori senza codice, per esempio di alcune route.

**Ritrovare il codice mostrato all'utente su Vercel**: progetto, Logs, cerca il codice nel campo di ricerca (la ricerca testuale trova il `digest` nella riga JSON), e filtra per livello Error. In locale: cerca lo stesso codice nell'output del terminale di `pnpm dev` o `pnpm start`. La riga ti dice dove (`route`, `routeType`) e che tipo di errore (`errorName`, `code`).

*Limiti, onesti*: (1) Next.js in produzione stampa **per conto suo** anche l'errore completo (messaggio e stack): non è controllabile da questo hook, quindi i log di Vercel possono contenere dati e vanno trattati come riservati (non incollarli in chat pubbliche, non girarli a terzi senza controllarli). (2) La riga è provata dai test del formattatore e dal fatto che `typecheck` e la build accettano l'hook con la firma di Next 16.3; **non è provata** su un deploy reale di Vercel.

## 3. Backup e ripristino

Provato in locale e nei test (`tests/backup.test.ts`: ogni tabella è nel backup o esclusa con un motivo; ripristino con verifica delle impronte e della catena dell'audit).

**Chiavi.** Il backup è cifrato con la chiave pubblica (`BACKUP_PUBLIC_KEY`). La chiave **privata** la generi tu con `pnpm backup:keygen` e la custodisci fuori dal computer (gestore di password, chiavetta, carta). Non finisce mai nel server e nessuno può recuperarla: **senza, nessun backup si riapre**.

- Se perdi la chiave privata: genera una nuova coppia, aggiorna `BACKUP_PUBLIC_KEY` e fai subito un backup nuovo. Quelli vecchi non si possono più aprire.
- Se vuoi cambiare chiave: conserva anche la vecchia finché esistono backup fatti con lei.

**Firma dei backup (`BACKUP_SIGNING_SECRET`).** Con questo segreto di server (almeno 32 caratteri, `openssl rand -base64 32`) ogni backup nuovo contiene la voce `manifest.sig`: una firma HMAC-SHA256 del manifest, che a sua volta contiene le impronte di tutte le tabelle e di tutti i file. Chi conosce solo la chiave pubblica (e può scrivere nella cartella dei backup) non può quindi fabbricare un backup accettato. È facoltativo, ma `pnpm doctor` avvisa se i backup sono configurati e il segreto manca.

- **Custodiscine una copia fuori dal server** (gestore di password), insieme alla chiave privata: serve per ripristinare.
- **Se lo perdi** (o lo cambi): i backup già fatti firmati col vecchio segreto non si verificano più col nuovo e il ripristino li rifiuta («la firma dell'archivio non è valida»). Una firma sbagliata si rifiuta sempre, anche con `--allow-unsigned` (quello copre solo l'*assenza* di firma). Le strade: (1) ritrova il vecchio segreto e impostalo solo per il ripristino; (2) se non c'è, ripristina **senza** segreto nell'ambiente (il ripristino scrive «firma presente ma non verificata»): in quel caso la garanzia contro i backup fabbricati la dai tu confrontando l'impronta annotata (`--expect-sha256`, sotto). Dopo il cambio imposta il segreto nuovo e fai subito un backup nuovo.
- **Backup vecchi (senza firma)**: restano leggibili. Con il segreto impostato il ripristino li rifiuta, salvo `--allow-unsigned`.
- **Impronta annotata fuori banda**: dopo ogni backup che vuoi poter garantire, annota altrove la SHA-256 del file cifrato (colonna `archive_sha256` della tabella `backup_run`, oppure `sha256sum <file.gibk>`) e usa `pnpm backup:restore ... --expect-sha256 <impronta>`: il confronto avviene prima di aprire il file.
- **Limiti di lettura**: il ripristino rifiuta un archivio che si espande oltre 8 GiB totali (1 GiB per voce) o con un rapporto di compressione anomalo; per un archivio legittimo più grande usa `--max-bytes <byte>`.
- Se la firma è presente ma il segreto non è impostato, il ripristino legge l'archivio e scrive «presente ma non verificata»: non è una verifica.

**Ripristino in un ambiente nuovo e vuoto**

1. Crea un database vuoto (un nuovo progetto Neon, oppure cancella `.pglite/` in locale) e applica le migrazioni: `pnpm db:migrate`.
2. Usa una cartella dei documenti vuota (`STORAGE_DIR`).
3. Prima verifica: `pnpm backup:restore --archive <file.gibk> --key <privata.pem> --verify-only` (con `BACKUP_SIGNING_SECRET` impostato nell'ambiente; aggiungi `--expect-sha256 <impronta>` se l'hai annotata, e `--allow-unsigned` solo per un backup vecchio).
4. Poi ripristina: lo stesso comando senza `--verify-only`. Rifiuta un database che contiene già dati, e annulla tutto se un'impronta o la catena dell'audit non tornano.
5. Dopo il ripristino le sessioni non ci sono più (non si salvano): rifai l'accesso. Utente, password, TOTP e passkey tornano con i dati.
   - Stesso dominio: le passkey funzionano come prima.
   - Dominio diverso: le passkey sono legate al dominio e **non funzionano**. Entra con password e TOTP (o un codice di recupero) e aggiungine una nuova da `/sicurezza/configurazione`.
6. Apri Impostazioni, Registro delle modifiche, premi «Verifica ora» e confronta numero e impronta dell'ultima riga con quelli dell'elenco dei backup.

**Dove stanno i dati ora.** Documenti in `.storage/` e backup in `backups/`, sullo stesso disco: non sono due copie. Su Vercel il disco è a sola lettura, quindi **prima di usare l'app online serve un adattatore per i file** (Blob privato o S3) e uno per i backup. Non esistono ancora.

## 4. Migrazioni e aggiornamenti

- Le migrazioni sono in `drizzle/` e sono **additive**. La CI fallisce se lo schema cambia senza una migrazione.
- Prima di pubblicare codice che ne richiede una: fai un backup, poi `pnpm db:migrate` contro il database di produzione, poi pubblica. Drizzle le applica in una transazione (comportamento di Drizzle, *non provato* su Neon).
- Non ci sono migrazioni «giù». Se una versione nuova va male, torna al codice precedente (che con uno schema additivo continua a funzionare) e, solo se i dati sono stati toccati, ripristina il backup.
- Aggiornamenti: Dependabot apre ogni lunedì una richiesta per le versioni minori e di correzione (raggruppate) e una per ogni versione maggiore. Si fondono solo con la CI verde (tipi, lint, confini, test su PGlite e su Postgres reale, e2e sulla build di produzione).
- Ogni lunedì il flusso «Sicurezza delle dipendenze» esegue `pnpm audit --prod --audit-level high`. Una vulnerabilità nota di `braces` (GHSA-vfj7-8cjw-p6xm, dentro lo strumento `shadcn` che serve solo a costruire l'interfaccia, senza versione corretta disponibile) è esclusa in `package.json` con un motivo; una moderata di `esbuild` resta visibile ma sotto la soglia (arriva da uno strumento di sviluppo, non gira online). Riguarda queste due voci a ogni aggiornamento di `shadcn` e di `better-auth`.
- Runtime: Node 24 (`.nvmrc`, `engines`). Cambiarlo è una decisione da fare insieme a Vercel e alla CI.

## 5. Segreti e variabili

L'elenco commentato è in `app/.env.example`. Cosa succede se li perdi o li cambi:

| Variabile | A cosa serve | Se la perdi o la cambi |
|---|---|---|
| `DATABASE_URL` | Connessione al database | Cambiarla significa puntare un altro database |
| `BETTER_AUTH_SECRET` | Firma le sessioni e cifra i segreti di Better Auth | Tutte le sessioni decadono. Può rendere illeggibile il segreto TOTP già configurato (*non provato*): tieni a portata una passkey valida e i codici di recupero prima di cambiarlo |
| `BETTER_AUTH_URL` | Origine pubblica; da qui derivano le passkey | Cambiare dominio rende inutili le passkey esistenti (vedi §3, punto 5) |
| `OWNER_BOOTSTRAP_TOKEN` | Crea l'account del proprietario | **Rimuovilo** dopo la prima configurazione. Serve di nuovo solo per l'emergenza del §6 |
| `BACKUP_PUBLIC_KEY` | Cifra i backup | Vedi §3: la chiave privata è solo tua |
| `BACKUP_SIGNING_SECRET` | Firma (HMAC) il manifest dei backup; il ripristino rifiuta un archivio senza firma o con firma diversa | Vedi §3 «Firma dei backup»: custodiscine una copia fuori dal server. Persa: i backup firmati non si verificano più |
| `CRON_SECRET` | Autorizza le chiamate del cron (almeno 16 caratteri) | Cambialo nel progetto Vercel: è Vercel a mandarlo. Senza, le route `/api/cron/*` rispondono 401 |
| `RESEND_API_KEY`, `MAIL_FROM` | Email degli avvisi | Senza, gli avvisi restano nell'app e non partono email |
| `STORAGE_DIR`, `BACKUP_DIR`, `BACKUP_KEEP` | Cartella dei documenti, dei backup, quanti backup tenere | Solo disco locale |

Non si memorizzano mai credenziali di portali di terzi (SPID, Entratel, banche): non inserirle in nessun campo di testo libero.

## 6. Ho perso l'accesso

L'app ha un solo utente e nessun supporto: non c'è un «password dimenticata» via email. Se hai ancora l'accesso, tutto si gestisce da Impostazioni, Sicurezza dell'account: aggiungere una passkey sul nuovo dispositivo, rimuovere quella smarrita (l'ultima non si può togliere), chiudere le sessioni sconosciute («Esci dagli altri dispositivi»), rigenerare i codici di recupero e cambiare la password. Dopo un sospetto furto del dispositivo fai queste ultime tre cose. Dal caso meno grave:

1. **Perso la passkey, ho ancora l'app TOTP o un codice di recupero.** Dalla pagina Accesso scegli password e codice (TOTP, oppure «usa un codice di recupero»). Poi aggiungi una nuova passkey da `/sicurezza/configurazione`. Ogni codice di recupero vale una volta sola.
2. **Perso l'app TOTP ma ho una passkey.** Entra con la passkey: con la verifica dell'utente vale già come due fattori e non chiede il TOTP.
3. **Perso tutto** (passkey, TOTP e codici). Non c'è un ripristino dall'app, di proposito. Ultima risorsa, che richiede accesso al database (*la cancellazione a cascata è verificata da `tests/single-owner.test.ts`; la procedura completa non è stata provata su un ambiente online*):
   1. Fai un backup, o una copia del database.
   2. `delete from "user";` — porta via account, password, sessioni, passkey e TOTP. **I dati restano** (nessuna tabella di dati dipende dall'utente) e il registro delle modifiche non si tocca.
   3. Imposta un nuovo `OWNER_BOOTSTRAP_TOKEN` (almeno 32 caratteri, `openssl rand -base64 32`) e riavvia l'app.
   4. Apri `/configurazione-iniziale`, crea l'account, attiva TOTP e una passkey, salva i codici di recupero, **togli di nuovo il token**.
   5. Nel registro delle modifiche resta traccia della ricreazione (azione `owner.bootstrap`, eseguita dal sistema).

   Per questo l'accesso al database va protetto come l'accesso all'app: chi lo ha può fare questa procedura.

### Riconferma recente

Per scaricare l'esportazione completa, un backup o un pacchetto di condivisione, e per rimuovere una passkey, chiudere sessioni, rigenerare i codici di recupero o cambiare la password, l'app chiede di **riconfermare** che sei tu, anche con la sessione aperta. La riconferma vale **10 minuti**. Cliccando un link di scarico vieni portato su `/riconferma`: scegli «Conferma con la passkey», oppure password + codice dell'app di autenticazione (o un codice di recupero), e poi torni alla pagina di partenza (per uno scarico, il file parte). La prova è un cookie firmato, legato alla sessione in uso: se chiudi la sessione o cambi browser va rifatta.

- **«Serve una riconferma recente»** nella pagina Sicurezza: usa il link «Riconferma l'accesso» in cima alla pagina e ripeti l'operazione.
- Strumenti che non sono un browser (curl, script) ricevono `403` con `{"error":"reconfirm_required"}` finché non c'è una riconferma valida: non esiste una via per ottenerla senza il browser, di proposito.
- I tentativi di password della riconferma condividono il tetto di 5 per 15 minuti con la pagina Sicurezza.
- La riconferma con la passkey fa un accesso vero: nella lista delle sessioni compare una sessione in più (si chiude da Sicurezza).
- Nulla da configurare: usa `BETTER_AUTH_SECRET`. Cambiarlo invalida anche le riconferme in corso (innocuo, si rifanno).

## 7. Il registro delle modifiche

Impostazioni, Registro delle modifiche. Ogni riga contiene l'impronta della precedente: «Verifica ora» ricalcola tutta la catena.

- Esito «nessuna anomalia»: nessuna riga è stata alterata o tolta *nel mezzo*.
- Esito «anomalia alla riga n.»: da quella riga le impronte non tornano. Non scrivere nulla nel database, fai una copia, e confrontala con un backup per capire cosa è cambiato.
- Limite noto: la **rimozione delle ultime righe** non si vede dalla verifica. Per questo l'impronta dell'ultima riga è mostrata in pagina e annotata in ogni backup (Impostazioni, Backup): confrontale di tanto in tanto.
- Chi ha il database come proprietario può disattivare i trigger: il registro rende evidente una manomissione, non la impedisce.

## 8. Qualcosa non va

| Sintomo | Prima cosa da guardare |
|---|---|
| `/api/health` risponde 503 | Il database è raggiungibile? `DATABASE_URL` giusta? In locale: `pnpm dev:db` è acceso? |
| Non so da dove cominciare | `pnpm doctor` (§2): controlla ambiente, database, migrazioni, proprietario, backup e registro, e dice cosa fare |
| Ogni pagina dà «Qualcosa non ha funzionato» | Il registro del server (Vercel, Logs): cerca il «Codice dell'errore» mostrato in pagina, è il `digest` della riga JSON (§2, «Leggere i log degli errori»). La pagina non mostra il motivo |
| `pnpm doctor` dice che mancano migrazioni | Fai un backup, poi `pnpm db:migrate` (§4) |
| `pnpm doctor` dice che `BACKUP_PUBLIC_KEY` è privata | Toglila dall'ambiente, imposta la pubblica; la privata resta solo a te (§3) |
| Gli avvisi non arrivano via email | `RESEND_API_KEY` e `MAIL_FROM` sono impostati? Gli avvisi nell'app compaiono comunque |
| Le scadenze non si aggiornano | Il cron giornaliero (Vercel, Cron Jobs) o il pulsante in Impostazioni, Notifiche e email. Il giro è sicuro da rifare |
| Il cron risponde 401 | `CRON_SECRET` mancante o diverso tra Vercel e l'app |
| Un documento non si apre | Il file è in `.storage/`? Il backup lo include: ripristina |
| La ricerca non trova un PDF | Le scansioni senza testo non si indicizzano (OCR spento): si trovano solo per titolo e nome del file |

## 9. Cosa questo manuale non copre

Il rilascio su Vercel (procedura nel `README.md`, mai provata), gli adattatori per i file online, la configurazione di un dominio e dei certificati, e qualunque aspetto legale o fiscale: l'app organizza e ricorda, non attesta nulla.
