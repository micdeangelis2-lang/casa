# Gestione Immobili

App web personale per organizzare dossier, documenti e scadenze di immobili in Italia.
Un solo utente (il proprietario); professionisti e uffici sono contatti in rubrica, senza accesso.

Requisiti, scelte e piano: `../Prompt finale - App gestione immobili.md`, `../docs/Stage A - Proposta di architettura.md`, `../DECISIONS.md`.

> L'app organizza e ricorda. Non fornisce consulenza legale, fiscale o tecnica e non attesta la conformità di un immobile.

## Stato

Tutti gli incrementi del piano sono costruiti (0-12): fondamenta e accesso del proprietario, territori/rubrica/immobili, documenti, backup, regole e dossier, scadenze e avvisi, pratiche e condivisione, condominio, tributi e pagamenti, manutenzioni e assicurazioni, locazioni e ricettività, limiti dell'assistenza e consolidamento (accessibilità, accessi, prestazioni). L'app funziona **in locale**: i file dei documenti e i backup stanno su disco (`.storage/`, `backups/`), perché gli adattatori per Vercel Blob/S3 non ci sono ancora (serve l'account: vedi `../DECISIONS.md`, E15 ed E24). Sopra il piano sono stati aggiunti: pagine di errore e di «non trovato», quadro economico, «Da controllare», ricerca globale, calendario `.ics`, registro delle modifiche con verifica della catena, controllo di salute `/api/health`, manuale operativo (`../docs/RUNBOOK.md`), Dependabot e controllo settimanale delle dipendenze. Cron giornaliero, email degli avvisi (Resend) e pipeline CI sono scritti ma **mai provati su servizi reali**. Il link di condivisione a scadenza (D7) non c'è: si condivide solo con pacchetti ZIP.

## Moduli

| Menu | Cosa fa | Cosa NON fa |
|---|---|---|
| Immobili, Rubrica | Beni (anche pertinenze) con titolarità, catasto, caratteristiche tecniche; contatti con ruoli | Non presume legami tra beni: sono dichiarati |
| Documenti | Versioni, categorie, ricerca nel testo dei PDF, duplicati, elenco a pagine di 50 | Non legge le scansioni (OCR spento) |
| Regole, Dossier | Regole versionate come dati, con fonte e stato di verifica; dossier per bene con la spiegazione di ogni voce | Non contiene norme e non dice che un bene è a norma |
| Scadenze, Avvisi | Date calcolate da regole o scritte da te, prove, avvisi in app ed email, giro giornaliero | Non stabilisce cosa sia dovuto per legge |
| Pratiche, Condivisione | Contatti assegnati, richieste, pareri «informativi» o «validati»; pacchetti ZIP con registro | Nessun accesso per i professionisti |
| Condominio | Millesimi, preventivi e rate, assemblee e delibere, lavori, sinistri, contratti | Non interpreta le delibere: le soglie le scrivi tu |
| Tributi e pagamenti | Tipi scritti da te, importi indicati, pagamenti con prova, dichiarazioni, riepilogo per il consulente (stampa e CSV) | Nessuna aliquota, nessun calcolo di imposta |
| Manutenzioni e lavori | Interventi, preventivi, avanzamenti, fatture, garanzie, ispezioni periodiche | Non valuta preventivi né garanzie |
| Assicurazioni | Polizze, garanzie copiate a mano, premi, sinistri e comunicazioni | Non dice se un evento è coperto |
| Locazioni e ricettività | Tipo reale scelto per primo, contratto, canoni, codici, adempimenti | I requisiti del territorio sono regole, non codice |
| Quadro economico | Per anno e per immobile, la somma di ciò che hai registrato in tributi, assicurazioni, manutenzioni, condominio e locazioni; stampa e CSV | Non ripartisce le spese tra immobili (resta «Non ripartito»), non calcola imposte, deducibilità o rendimenti |
| Da controllare | Fatti ricavati dai dati (date superate, scadenze vicine, pagamenti senza prova, rate e canoni arretrati, backup vecchio…) con un rimando alla scheda | Non dice se una situazione sia irregolare |
| Cerca (casella in alto) | Un testo in tutta l'app, anche nel testo dei PDF; maiuscole e accenti non contano | Non registra cosa cerchi |
| Calendario `.ics` (in Scadenze) | Le scadenze aperte come file da importare in Google/Apple Calendar o Outlook, con promemoria alle 9:00 per ogni preavviso | È un file scaricato, non un abbonamento: non si aggiorna da solo |
| Registro delle modifiche (Impostazioni) | Chi ha cambiato cosa e quando; ultima riga con la sua impronta; «Verifica ora» ricalcola la catena | Non mostra mai i valori; la rimozione delle ultime righe emerge solo confrontando l'impronta con quella dei backup |
| Limiti (barra laterale) | «Cosa fa e cosa non fa l'app» (sezione 12 della specifica) | — |

## Requisiti

- **Node 24 LTS** (come su Vercel). `.nvmrc` alla radice. Node 25 funziona per l'app e i test, ma `pnpm arch` (dependency-cruiser) non lo supporta: usa Node 24 (nvm-windows, fnm, Volta) oppure `npx -y node@24 node_modules/dependency-cruiser/bin/dependency-cruiser.mjs src --config .dependency-cruiser.cjs`.
- pnpm 10.

## Avvio in locale

Senza un database Neon, usa quello locale (Postgres in-process con i dati su disco in `.pglite/`, ignorato da git):

```bash
pnpm install
cp .env.example .env.local      # poi compila i valori (vedi sotto per quelli del db locale)
pnpm dev:db                     # terminale 1: database su 127.0.0.1:54320, applica da solo le migrazioni
pnpm dev                        # terminale 2: http://localhost:3000
```

Valori per il database locale in `.env.local`: `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54320/postgres` e **`DATABASE_POOL_MAX=1`** (il socket di PGlite non regge più pool concorrenti). `BETTER_AUTH_SECRET` e `OWNER_BOOTSTRAP_TOKEN`: genera con `openssl rand -base64 32`.

Chiudi `pnpm dev:db` con Ctrl+C (non uccidendo il processo) per scrivere i dati in modo pulito. Per ripartire da zero cancella `.pglite/`. Con un Postgres vero (Neon) si usa invece `pnpm db:migrate` e non serve `dev:db`.

Alla prima apertura l'app porta a `/configurazione-iniziale`: servono il token `OWNER_BOOTSTRAP_TOKEN`, poi si attivano l'app di autenticazione (TOTP, con i codici di recupero) e almeno una passkey. Finché la sicurezza non è completa l'app non è accessibile. Dopo il primo account **rimuovi il token dall'ambiente**.

## Comandi

| Comando | Cosa fa |
|---|---|
| `pnpm check` | tipi + lint + confini tra moduli + test (tutto quello che gira in CI, tranne e2e) |
| `pnpm test` | test unitari e di integrazione (Vitest, PGlite in-process: nessun Docker) |
| `pnpm exec playwright test` | e2e sulla **build di produzione** (CSP, cookie, passkey con autenticatore virtuale, accessibilità) |
| `pnpm arch` | regole di dipendenza tra livelli e moduli (dependency-cruiser) |
| `pnpm backup:keygen [file.pem]` | genera la coppia di chiavi dei backup: stampa la riga `BACKUP_PUBLIC_KEY` e scrive la chiave PRIVATA nel file (da custodire fuori dal computer) |
| `pnpm backup:run` | fa subito un backup cifrato (come il pulsante in Impostazioni > Backup) |
| `pnpm backup:restore --archive <f.gibk> --key <privata.pem> [--verify-only]` | ripristina in un ambiente nuovo e vuoto (dopo `pnpm db:migrate`), oppure verifica soltanto |
| `pnpm territory:import` | importa tutti i Comuni italiani dall'elenco ISTAT (idempotente); dopo `pnpm db:migrate` |
| `pnpm db:generate` | genera una migrazione dallo schema Drizzle |
| `pnpm auth:schema` | rigenera `src/platform/db/schema/auth.ts` dopo aver cambiato i plugin di auth |

Con `TEST_DATABASE_URL` (nome del database **con "test"**: i test cancellano lo schema) i test usano un Postgres reale, come in CI.

## Backup

Impostazioni > Backup ed esportazione. I backup sono archivi **cifrati con la tua chiave pubblica**: il server non può aprirli. Passi: `pnpm backup:keygen`, metti la riga `BACKUP_PUBLIC_KEY=...` in `.env.local`, e **conserva la chiave privata fuori da questo computer** (senza non si riapre nulla e nessuno può recuperarla). L'esportazione completa è invece in chiaro e senza password. Ora la destinazione è la cartella `backups/`, che sullo stesso disco non è una vera seconda copia. Provare il ripristino una volta prima di caricare documenti importanti.

## Regole e dossier

Regole (menu) e Dossier (scheda di ogni immobile). Le regole dicono quali voci aspettarsi per un bene in base alle sue caratteristiche (tipo, uso, condominio, titolarità, caratteristiche tecniche) e al territorio. Modificarle crea una nuova versione; le precedenti restano e si possono confrontare. Il dossier mostra per ogni voce **perché compare** (regola, versione, livello, fonte, condizioni e fatti usati) e l'etichetta «regola non verificata» finché non la verifichi. Stato, note e documenti collegati sono solo tuoi: il motore non li cambia mai, e una regola che non vale più lascia la voce «da rivedere». Il riepilogo conta gli stati e **non** dice che un bene è a norma. Le regole di esempio (pulsante in Regole) sono illustrative e vanno validate con un professionista.

## Rilascio su Vercel (procedura, NON ancora provata)

1. **Database**: crea un progetto Neon in regione UE, copia la stringa *pooled* in `DATABASE_URL` e applica le migrazioni dal tuo computer con `pnpm db:migrate` (le migrazioni sono in `drizzle/`, 0000-0022).
2. **Archiviazione dei file**: l'adattatore su disco **non funziona su Vercel** (filesystem a sola lettura). Prima del primo deploy con documenti serve un adattatore Blob privato o S3-compatibile dietro `StoragePort` (`src/platform/storage`) e uno per `BackupDestination`.
3. **Variabili d'ambiente** (Project Settings > Environment Variables): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (il dominio di produzione: le passkey sono legate al dominio), `OWNER_BOOTSTRAP_TOKEN` (solo per la prima configurazione, poi rimuovilo), `BACKUP_PUBLIC_KEY`, `CRON_SECRET`, facoltative `RESEND_API_KEY` e `MAIL_FROM`. L'elenco commentato è in `.env.example`.
4. **Cron**: `vercel.json` pianifica `/api/cron/giornaliero` alle 05:00 UTC (rivalutazione dei dossier, date delle scadenze, avvisi ed email). Vercel lo chiama con `Authorization: Bearer <CRON_SECRET>`. Il cron del backup (`/api/cron/backup`) si aggiunge quando c'è una destinazione utilizzabile su Vercel.
5. **Dopo il deploy**: apri `/configurazione-iniziale`, crea l'account, attiva TOTP e almeno una passkey, **rimuovi `OWNER_BOOTSTRAP_TOKEN`**, genera la chiave dei backup con `pnpm backup:keygen` e **prova un ripristino** su un ambiente vuoto prima di caricare documenti importanti.
6. **Migrazioni successive**: `pnpm db:migrate` contro il database di produzione *prima* di pubblicare il codice che le richiede (le migrazioni sono additive).

## Controlli automatici

Oltre ai test dei moduli (dominio e integrazione) e agli e2e sui flussi, ci sono controlli che guardano tutta l'app:

| Controllo | Dove | Cosa garantisce |
|---|---|---|
| Messaggi | `tests/messages.test.ts` | Ogni chiave `t("...")` usata nel codice esiste in `messages/it.json` |
| Linguaggio neutro | `tests/neutral-language.test.ts`, `e2e/neutral-language.spec.ts` | Nessun messaggio, stringa o schermata afferma conformità, «non dovuto», validità o avviabilità |
| Accessi | `tests/authz.test.ts` | Ogni pagina, route e azione del server verifica la sessione del proprietario |
| Confine server/client | `tests/client-boundary.test.ts` | Il codice del browser non importa database, moduli o variabili d'ambiente |
| Accessibilità | `e2e/accessibility-responsive.spec.ts` | WCAG 2.x A/AA su tutte le schermate, a 1280 e 390 px, senza scorrimento orizzontale |
| Prestazioni | `tests/documents-scale.test.ts`, `e2e/pagination.spec.ts` | 5.000 documenti: conteggio e pagina in decine di millisecondi; elenco a pagine |
| Archivio | `tests/backup.test.ts` | Ogni tabella è nel backup o esclusa con un motivo |
| Pagine di errore | `tests/problem-pages.test.ts`, `e2e/problem-pages.spec.ts` | Un indirizzo inesistente risponde 404 (non 200); un errore mostra solo il codice, mai il messaggio |
| Salute | `tests/health.test.ts`, `e2e/health.spec.ts`, `tests/authz.test.ts` | `/api/health` risponde 200 o 503 senza dati né motivi; è l'unica route senza sessione oltre ad accesso e cron |
| CSV e calendario | `tests/csv.test.ts`, `tests/ics.test.ts` | Nessuna formula eseguibile in un CSV; file `.ics` con righe piegate, escape e fine riga corretti |

## Operatività

`../docs/RUNBOOK.md` raccoglie le routine (backup, verifica del registro), il monitoraggio (`/api/health`), il ripristino, le migrazioni, cosa succede se cambi un segreto e cosa fare se perdi l'accesso, indicando di ogni procedura se è stata provata. Dependabot propone gli aggiornamenti ogni lunedì (`../.github/dependabot.yml`); `../.github/workflows/security.yml` controlla le vulnerabilità note delle dipendenze di produzione.

## Documentazione

| Documento | Cosa contiene |
|---|---|
| [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) | Livelli e regole di dipendenza, mappa dei moduli, percorso di scrittura e audit, modello di accesso, tabelle per modulo, backup, strategia di test |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Avvio, comandi, come si aggiunge un modulo, una migrazione, un messaggio, una pagina, una route, uno spec e2e; checklist e trappole note |
| [`../SECURITY.md`](../SECURITY.md) | Modello di minaccia, cosa è protetto e cosa no, come segnalare un problema |
| [`../docs/API.md`](../docs/API.md) | Ogni route HTTP: autenticazione, parametri, risposta, codici di stato |
| [`../docs/RUNBOOK.md`](../docs/RUNBOOK.md) | Manuale operativo: routine, backup e ripristino, migrazioni, accesso perso |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Registro delle modifiche per incremento |
| [`../DECISIONS.md`](../DECISIONS.md) | Le decisioni prese e il perché |
| [`../docs/REGISTRO_CODEBASE.yaml`](../docs/REGISTRO_CODEBASE.yaml) | Registro di moduli, utility e pattern |

## Struttura

```
src/
  platform/    porte e adattatori trasversali: db, audit, auth, config, clock
  modules/     un modulo = un dominio di business (domain / application / infrastructure / ui)
  shared/      tipi e utility pure
  app/         route Next.js, sottili: chiamano i casi d'uso
drizzle/       migrazioni SQL versionate (anche trigger e funzioni dell'audit)
e2e/           test Playwright e supporto (db in-process, TOTP, WebAuthn virtuale)
tests/         test di integrazione e di architettura
```

Regole applicate in CI (`pnpm arch` e `tests/architecture.test.ts`): il dominio non importa framework, ORM o driver; i moduli si parlano solo tramite `index.ts`; nessun nome di Comune o Regione nel codice (sono dati).

## Sicurezza: cosa sapere

- **Ogni scrittura passa da `runInUnitOfWork`** (`src/platform/db/unit-of-work.ts`): modifica e riga di audit nella stessa transazione.
- **Ogni pagina, azione o route che tocca dati chiama `requireOwner()`** (`src/platform/auth/owner.ts`). Il controllo nel layout e nel proxy è solo ottimistico.
- L'audit rende evidente, non impossibile, una manomissione: chi è proprietario del database può disattivare i trigger. La rimozione delle ultime righe emerge solo confrontando l'hash di testa con una copia esterna (backup, interfaccia).
- Un solo utente è garantito dal database (indice `user_single_owner`) oltre che dal codice.
- Non si memorizzano mai credenziali di terzi (SPID, Entratel, portali).
