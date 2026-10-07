# Registro delle modifiche

Formato ispirato a [Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/). Il progetto non ha ancora versioni rilasciate né commit: ogni voce corrisponde a un **incremento** del piano (§11 della proposta, D10) o a un gruppo di aggiunte, ed è ricavata da [`DECISIONS.md`](DECISIONS.md) (le sigle `E…` rimandano alla decisione, dove sta il perché). Le date sono quelle delle decisioni.

## [Non rilasciato]

<!-- Le modifiche successive al 2026-10-06 vanno qui, sotto Aggiunto / Modificato / Corretto / Rimosso, prima di diventare una voce datata. -->

## [Aggiunte del 2026-10-06 (E50–E58)] - 2026-10-06

### Aggiunto
- Pagine di «non trovato» (radice e area riservata) e di errore (`error.tsx`, `global-error.tsx`): l'errore mostra solo il codice `digest`, mai il messaggio (E50).
- Quadro economico (`/economia`, `/api/economia`, modulo `economy`, sola lettura): somma per anno e per immobile di ciò che è stato registrato in tributi, assicurazioni, manutenzioni, condominio e locazioni; non ripartisce mai una spesa tra immobili; stampa e CSV (E52).
- «Da controllare» (`/controlli`, scheda in panoramica, modulo `attention`, sola lettura): fatti ricavati dai dati con gravità «alta» o «normale» e un rimando alla scheda (E53).
- Ricerca globale (casella nell'intestazione, `/cerca`, modulo `search`, sola lettura) in tutte le sezioni, anche nel testo dei PDF; non registra cosa si cerca (E54).
- Calendario `.ics` (`/api/calendario`, pulsante in Scadenze): scadenze aperte come eventi «tutto il giorno», `UID` stabile e un promemoria alle 9:00 per ogni preavviso; costruttore in `src/shared/ics.ts` (E55).
- Registro delle modifiche (`/impostazioni/registro`): righe a pagine con filtro per area, ultima riga con la sua impronta e «Verifica ora» (`audit_log_verify()`) (E56).
- `/api/health`: controllo di salute pubblico (200 `{"status":"ok"}` o 503 `{"status":"error"}`, tempo massimo 3 secondi) (E57).
- Manuale operativo `docs/RUNBOOK.md`, `.github/dependabot.yml` (aggiornamenti ogni lunedì, raggruppati) e `.github/workflows/security.yml` (`pnpm audit --prod --audit-level high`) (E58).

### Modificato
- Il CSV è ora una sola implementazione in `src/shared/csv.ts` (separatore `;`, decimali con la virgola, BOM UTF-8, CRLF), usata da riepilogo tributi, quadro economico e indice dei pacchetti di condivisione (E51).

### Corretto
- L'indice CSV dei pacchetti ZIP di condivisione (dati che partono verso terzi) non neutralizzava le formule: ora lo fa (E51).
- Con un `loading.tsx` a livello `(app)`, `notFound()` rispondeva HTTP 200 invece di 404 (scoperto dall'e2e del registro): il file non c'è più (E50).

### Rimosso
- Simboli mai usati (funzioni, tipi, costanti di dominio, 31 chiavi di messaggio, il `csvCell` duplicato di Tributi), dopo averli cercati uno per uno; nessun file eliminato (E50).

### Sicurezza
- Esclusa in `app/package.json` (`pnpm.auditConfig.ignoreGhsas`) la sola GHSA-vfj7-8cjw-p6xm (`braces`, dentro lo strumento `shadcn`, senza versione corretta); la vulnerabilità moderata di `esbuild` resta visibile sotto soglia (E58).

## [Incremento 12 — Consolidamento] - 2026-10-06

### Aggiunto
- Test statici che falliscono se manca una chiave di messaggio, se una pagina, route o azione non verifica la sessione, o se il codice del browser importa indici di moduli, piattaforma o `process.env` (E49).
- Vocabolario per i componenti client via `client.ts` anche per Beni e Rubrica (E49).
- Audit di accessibilità WCAG su tutte le schermate, a 1280 e 390 px (E49).

### Modificato
- Elenco documenti paginato (50 per pagina), con conteggio con gli stessi filtri e letture leggere per titoli e menu (tetto 1000, `PICKER_LIMIT`). Misura su 5.000 documenti (PGlite in memoria): conteggio 16 ms, prima pagina 24 ms (E49).

### Corretto
- Un blocco di comandi scorrevole non era raggiungibile da tastiera (E49).

## [Incremento 11 — Avvisi di prodotto] - 2026-10-06

### Aggiunto
- Pagina `/limiti` («Cosa fa e cosa non fa l'app»), collegata dall'avvertenza sempre visibile nella barra laterale e dalla panoramica (E48).
- Verifica automatica del linguaggio neutro: nessun messaggio, stringa del codice o schermata contiene un verdetto (conforme, in regola, non dovuto, valida/non valida, puoi avviare) (E48).

## [Incremento 10 — Locazioni e ricettività] - 2026-10-05

### Aggiunto
- Modulo Locazioni e ricettività: il tipo reale (abitativa, transitoria, studenti, breve/turistica, struttura ricettiva) si sceglie per primo e decide i campi; contratto, canoni, cauzione, registrazione e codici. I requisiti per territorio sono regole a dati, non codice. Il tipo di attività in corso è un nuovo fatto del bene (`letting.types`) nell'editor delle regole; gli ospiti delle locazioni brevi non si registrano (E46).

### Modificato
- Il dossier si riallinea alle regole nella stessa transazione di ogni cambiamento delle locazioni (E46).
- Le scadenze collegate ai dati seguono le correzioni: si chiudono a importo coperto o adempimento eseguito, si riaprono se il dato viene corretto, si archiviano quando la voce è sostituita o tolta (E47, 2026-10-06).

## [Incremento 9 — Manutenzioni e Assicurazioni] - 2026-10-05

### Aggiunto
- Manutenzioni: interventi con preventivi, avanzamenti e fatture; un preventivo accettato porta l'intervento ad «approvato» e uno ricevuto a «con preventivo», solo in avanti. Ispezioni periodiche come scadenze ricorrenti ancorate alla prima data; garanzie con inizio e fine scritti dal proprietario e promemoria facoltativo (E44).
- Assicurazioni: polizze con garanzie copiate a mano (titolo, somma assicurata, franchigia), premi, sinistri con stato, importi e comunicazioni. L'app non dice mai «coperto», «liquidabile» o «termine rispettato» (E45).

## [Incremento 8 — Tributi e pagamenti] - 2026-10-05

### Aggiunto
- Tipi di tributo scritti dal proprietario (nessuna aliquota né scadenza di legge nel codice); voci per bene, tipo e anno con importo atteso facoltativo; pagamenti con prova; dichiarazioni. La situazione dipende solo dai dati registrati e non dice mai che un tributo sia assolto, dovuto o non dovuto. Chiudere una voce senza pagamenti richiede un motivo scritto (E43).
- Riepilogo per il consulente, stampabile e in CSV (UTF-8 con BOM, `;`, virgola decimale, formule neutralizzate) (E43).

## [Incremento 7 — Condominio] - 2026-10-05

### Aggiunto
- Modulo Condominio: un bene sta in un solo condominio; millesimi come interi ×10.000 (la somma si mostra e si segnala se non è 1000, senza imporla); rate ripartite con il resto maggiore (la somma è sempre il totale al centesimo); soglie di voto scritte dal proprietario, `checkVotes` dice solo «da ricontrollare» (E40).
- Importi sempre in centesimi interi; input accettato in «1.234,56», «50.000», «1234.5»; `formatCents` mette sempre il separatore delle migliaia. Helper di Zod in `shared/zod.ts`, validazione in `shared/result.ts` (E41).

### Modificato
- Colore `destructive` del tema scurito per il contrasto (WCAG AA) e area cliccabile minima di 24 px per le caselle di spunta, su richiesta dei controlli automatici (E42).

## [Incremento 6 — Pratiche e Condivisione] - 2026-10-05

### Aggiunto
- Pratiche: contatti della rubrica (senza accesso), richieste di documenti e pareri «informativi» oppure «validati formalmente», scelti dal proprietario; l'app non ne trae conclusioni (E38).
- Condivisione: pacchetto ZIP come snapshot (jsonb) servito identico, file in streaming con impronta verificata, tetto di riservatezza con consenso esplicito per ciascun documento più riservato, registro delle condivisioni; un pacchetto revocato risponde 410 (E39).

### Note
- Il link di condivisione a scadenza (D7) non è stato fatto: resta rimandato, si condivide solo con pacchetti ZIP (E39).

## [Incremento 5 — Scadenze e Avvisi] - 2026-10-05

### Aggiunto
- Scadenze con date calcolate sempre relative a un'ancora (annuale fissa, relativa a una data, ricorrente ogni N giorni/mesi/anni, manuale), spostamento al giorno lavorativo con festivi a dati (`holiday_rule`, Pasqua calcolata), orizzonte da oggi a +400 giorni (E35).
- Avvisi in app ed email (`MailPort`, adattatore Resend): tabella `notification` con chiave unica che rende l'invio idempotente; preavvisi per priorità, escalation dei ritardi a 1, 3, 7, 14, 30 giorni e poi ogni 30 (tetto 365); le email partono solo per gli avvisi creati dopo la loro attivazione (E36).
- Giro giornaliero (`runDailyJob`) da `/api/cron/giornaliero` (`CRON_SECRET`) e dal pulsante in Impostazioni › Notifiche; `vercel.json` lo pianifica alle 05:00 UTC. Chiude l'apertura di E31 (E37).

### Note
- Cron, email Resend e pianificazione non sono verificati su servizi reali (serve l'account) (E36, E37).

## [Incremento 4 — Regole e Dossier] - 2026-10-05

### Aggiunto
- Regole come dati: `rule` con identità stabile e `rule_version` immutabile (un trigger vieta ogni modifica tranne `verification_status` e ogni cancellazione); una regola si disattiva, non si cancella (E27).
- Condizioni come albero JSON validato (`all`/`any`/`not`, `eq`, `in`, `gte`, `lte`, `exists`, `contains`) su un elenco chiuso di fatti; editor a moduli per l'elenco piatto (E28).
- Esiti «voce di dossier» e «avviso»; avvisi calcolati a ogni lettura (E29, poi la scadenza come terzo esito nell'incremento 5).
- Dossier (`dossier_item`) che unisce voci manuali e derivate; stato, nota e documenti sono solo del proprietario; una regola che non si applica più lascia la voce «da rivedere» (E30).
- Valutazione nella stessa transazione della modifica (bene, regola, «Rivaluta») (E31).
- Caratteristiche tecniche tipizzate dei beni (fatti `attributes.*` delle regole) (E32).
- Sei regole di esempio, tutte «da verificare» e in linguaggio neutro, caricate da un pulsante (idempotente per codice) (E33).
- Tredici categorie del dossier a dati (`dossier_category`, migrazione 0007) (E34).

## [Incremento 3 — Backup] - 2026-10-05

### Aggiunto
- Backup come archivio ZIP (manifest, `data/<tabella>.ndjson`, `files/<chiave>`, LEGGIMI) cifrato con la chiave pubblica del proprietario (AES-256-GCM a blocchi, chiave dati avvolta con RSA-OAEP, RSA 3072); `pnpm backup:keygen` genera la coppia (E21).
- Esportazione completa in chiaro e senza credenziali, scaricabile da Impostazioni › Backup (E22).
- Ripristino con `pnpm backup:restore` solo su un ambiente vuoto con lo stesso schema, con verifica delle impronte e della catena dell'audit; `--verify-only` controlla senza scrivere. Un test fa il giro completo e un altro fallisce se una tabella non è nell'archivio né esclusa con un motivo (E23).
- Destinazione su cartella (`BACKUP_DIR`, ultimi `BACKUP_KEEP` = 14 tenuti), download manuale, `pnpm backup:run` (E24).
- Route `/api/cron/backup` protetta da `CRON_SECRET` (E25).
- Storico `backup_run` con data, esito, dimensione, impronta dell'archivio e hash di testa dell'audit; eventi `backup.*` nell'audit senza dati personali (E26).

### Note
- Il secondo fornitore di backup non c'è (E24); il cron del backup non è provato su Vercel e non è in `vercel.json` (E25).

## [Incremento 2 — Documenti] - 2026-10-05

### Aggiunto
- Caricamento dei file da una server action (limite 25 MB per file, `bodySizeLimit` 26 MB) con verifica di byte, tipo e `sha256` (E14).
- `StoragePort` con adattatore su disco (`STORAGE_DIR`, predefinito `app/.storage/`); l'adattatore Vercel Blob non è scritto (E15).
- Dodici categorie documentali a dati, inserite dalla migrazione 0005 (E16).
- Ricerca: testo incorporato dei PDF estratto in processo (`unpdf`) e indicizzato con `tsvector` (dizionario `italian`, colonna generata e indice GIN); titolo e nome file con `ILIKE`; nessun `pg_trgm` (E17).
- Secondo punto d'ingresso `modules/documents/client.ts` con solo costanti e tipi per i componenti client (E18).
- Apertura del file da `/api/documenti/<id>/<versione>` (sessione obbligatoria, 401 senza); PDF e immagini in una nuova scheda, il resto si scarica (E19).
- Tipi di file riconosciuti dai byte (PDF, PNG, JPEG, GIF, WebP, TIFF; docx/xlsx/odt/ods; `.p7m`); duplicati (stesso `sha256` o stessa terna titolo/emittente/data) come solo avviso (E20).

## [Incremento 1 — Territori, Rubrica, Immobili] - 2026-10-05

### Aggiunto
- Un solo modulo di inserimento per tutti i beni (tipo, denominazione e Comune obbligatori; titolarità, catasto e collegamenti opzionali e ripetibili). Collegamenti dichiarati, mai dedotti, e non reciproci. Quote: la somma per tipo di diritto non può superare l'intero (frazioni esatte). L'audit registra i nomi dei campi cambiati, mai i valori (E11).
- Import di tutti i Comuni dall'elenco ISTAT con `pnpm territory:import` (idempotente); codici catastali dal file ufficiale. 7.896 Comuni, 107 province, 20 regioni importati nel database di sviluppo; un test di architettura vieta nomi di territori nel codice (E12).

### Modificato
- Target TypeScript ES2022 (servono i BigInt per le quote) (E13).

## [Incremento 0 — Fondamenta e accesso] - 2026-10-05

### Aggiunto
- App in `D:\casa\app\`, repository git alla radice (E1); pnpm, Node 24 LTS fissato con `.nvmrc` e `engines.node` (E2).
- Monolite modulare (domain / application / infrastructure) con confini applicati da `pnpm arch` e da test di architettura (D2).
- Audit append-only con catena di hash calcolata da trigger del database, scritto nella stessa transazione di ogni modifica (`runInUnitOfWork`).
- Accesso del proprietario con Better Auth: passkey (primaria, verifica utente obbligatoria) più password e TOTP o codice di recupero come via di riserva; creazione dell'account con token monouso; TOTP e almeno una passkey obbligatori per usare l'app; un solo utente garantito anche dal database (indice `user_single_owner`) (E6, D4).
- Limite di frequenza di Better Auth su database, indirizzo letto da `x-real-ip` (E7); schema di Better Auth generato dalla CLI (`pnpm auth:schema`) (E8).
- Test di integrazione ed e2e con PGlite (nessun Docker); con `TEST_DATABASE_URL` gli stessi test girano su un Postgres reale (E3).
- Sviluppo locale con `pnpm dev:db` (PGlite persistente) e `DATABASE_POOL_MAX=1` (E10).
- Commenti, nomi dei test e README in italiano (E9, da confermare: domanda aperta 6).

### Note
- CSP con nonce per richiesta, quindi `export const dynamic = "force-dynamic"` nel layout radice (E4); singleton `db` e `auth` su `globalThis` (E5).
- Non fatti nell'incremento 0: deploy di anteprima su Vercel e spike su Blob privato, cron e funzioni; esecuzione della pipeline GitHub Actions; nessun commit.
