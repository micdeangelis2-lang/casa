# Come si lavora su questo progetto

Guida per chi modifica il codice (anche se sei tu fra sei mesi). Per capire com'è fatto: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Per le scelte e il loro perché: [`DECISIONS.md`](DECISIONS.md). Per le procedure operative (backup, ripristino, accesso perso): [`docs/RUNBOOK.md`](docs/RUNBOOK.md). Per le route HTTP: [`docs/API.md`](docs/API.md). Per la sicurezza: [`SECURITY.md`](SECURITY.md).

L'app sta in `app/`: **tutti i comandi `pnpm` si lanciano da lì** (`cd app`).

## 1. Avvio

Requisiti: **Node 24** (`.nvmrc` alla radice, `engines.node: 24.x`) e **pnpm 10**.

```bash
cd app
pnpm install
cp .env.example .env.local      # poi compila i valori
pnpm dev:db                     # terminale 1: database locale su 127.0.0.1:54320 (PGlite, dati in .pglite/)
pnpm dev                        # terminale 2: http://localhost:3000
```

Valori minimi in `.env.local` per il database locale: `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54320/postgres`, **`DATABASE_POOL_MAX=1`** (il socket di PGlite non regge più connessioni), `BETTER_AUTH_SECRET` e `OWNER_BOOTSTRAP_TOKEN` (almeno 32 caratteri; `openssl rand -base64 32`), `BETTER_AUTH_URL=http://localhost:3000`. L'elenco commentato di tutte le variabili è in `app/.env.example`. `.env*` non si committa mai (è in `.gitignore`).

Alla prima apertura l'app porta a `/configurazione-iniziale`: servono il token, poi TOTP e almeno una passkey. Chiudi `pnpm dev:db` con Ctrl+C (non uccidendo il processo); per ripartire da zero cancella `.pglite/`. Per importare i Comuni: `pnpm territory:import` (dopo le migrazioni).

## 2. Comandi

| Comando | Cosa fa |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | server di sviluppo / build di produzione / avvio della build |
| `pnpm typecheck` | `next typegen && tsc --noEmit` (genera anche i tipi `PageProps`/`RouteContext`) |
| `pnpm lint` | ESLint (config Next.js, core-web-vitals e TypeScript) |
| `pnpm arch` | confini fra livelli e moduli (dependency-cruiser): **serve Node 24** |
| `pnpm test` | Vitest: dominio, integrazione su PGlite in-process, test statici trasversali |
| `pnpm exec vitest run tests/<file>.test.ts` | un solo file di test |
| `pnpm exec playwright test [e2e/<file>.spec.ts]` | e2e sulla **build di produzione** (porta 3100, database PGlite sulla 54329; 40-60 secondi di build) |
| `pnpm check` | tipi + lint + confini + test (come la CI, esclusi gli e2e) |
| `pnpm db:generate` | genera una migrazione dallo schema Drizzle |
| `pnpm db:migrate` | applica le migrazioni al database di `DATABASE_URL` (legge `.env.local`) |
| `pnpm auth:schema` | rigenera `src/platform/db/schema/auth.ts` (generato da Better Auth: non si modifica a mano) |
| `pnpm backup:keygen`, `backup:run`, `backup:restore` | chiavi, backup e ripristino (vedi [`docs/RUNBOOK.md`](docs/RUNBOOK.md)) |
| `pnpm territory:import` | importa i Comuni dall'elenco ISTAT (idempotente) |

Con `TEST_DATABASE_URL` (nome del database **con «test»**: i test cancellano lo schema `public`) i test girano su un Postgres reale, come nella CI.

## 3. Checklist di una modifica

Prima di dire «fatto», dalla cartella `app/`:

1. **Tipi**: `pnpm typecheck`. Controlla anche `tests/` ed `e2e/` (vedi le trappole).
2. **Lint**: `pnpm lint`.
3. **Confini**: `pnpm arch` (con Node 24; vedi §5 per un Node diverso).
4. **Test**: `pnpm test`. Se hai toccato un flusso dell'interfaccia o l'accesso, anche l'e2e del file interessato.
5. **Schema**: `pnpm exec drizzle-kit generate` deve rispondere **«No schema changes»**. Se non lo dice, hai cambiato lo schema senza migrazione (la CI fallisce, §6).
6. **Messaggi**: nessun testo dell'interfaccia scritto nel codice: sta in `messages/it.json`.
7. **Linguaggio neutro**: nessuna frase che dia un verdetto (§8).
8. **Documenti**: se hai aggiunto una route, descrivila in `docs/API.md`; se hai aggiunto un modulo o una tabella, aggiorna `docs/ARCHITECTURE.md`; una scelta nuova va in `DECISIONS.md` (tabella delle decisioni operative, con data e motivo) e un modulo o utility nel registro `docs/REGISTRO_CODEBASE.yaml`. `pnpm test` controlla route e link dei documenti.

## 4. Come si aggiunge…

### Un modulo

Un modulo è un dominio di business (`app/src/modules/<m>/`). Prendi come modello uno piccolo, ad esempio `directory` (Rubrica).

1. Crea `domain/` (tipi e validazioni Zod, solo logica pura), `application/` (`ports.ts` con le interfacce dei repository, `use-cases.ts` con i casi d'uso) e `infrastructure/` (repository Drizzle). Gli importi sono in **centesimi** interi, le date stringhe `AAAA-MM-GG`; per euro, date e identificativi usa gli helper in `src/shared/zod.ts`, per l'esito `Result`/`parseInput` in `src/shared/result.ts`: non riscriverli.
2. Crea `index.ts`: è l'**unica** porta d'ingresso. Le scritture ricevono una `UnitOfWork` (`uow.tx` per i dati, `uow.audit` per l'audit), le letture un `Db`. Gli altri moduli importano solo da qui (`pnpm arch` lo impone). Se dei componenti `"use client"` hanno bisogno di costanti o tipi del modulo, mettili in `client.ts` (l'`index.ts` non si importa dal browser).
3. Schema: nuovo file `src/platform/db/schema/<m>.ts` e `export * from "./<m>";` in `schema/index.ts`. Poi una migrazione (§ sotto).
4. **Backup**: aggiungi le nuove tabelle a `BUSINESS_TABLES` in `src/modules/backup/domain/archive.ts`, **dopo** le tabelle a cui puntano le chiavi esterne. `tests/backup.test.ts` fallisce se una tabella dello schema non è né lì né in `EXCLUDED_TABLES` (con un motivo). Se la migrazione inserisce dati di partenza, la tabella va anche in `SEEDED_TABLES`.
5. Interfaccia: pagine in `app/src/app/(app)/<percorso>/` (§ pagina), voce di menu in `src/app/(app)/_components/nav-items.ts` con le chiavi `nav.items.*` in `messages/it.json`.
6. Test: di dominio (funzioni pure), di integrazione con `createTestDb()` (`tests/helpers/test-db.ts`), e uno spec e2e (§ spec).
7. Se vuoi che il modulo compaia in ricerca, «Da controllare» o quadro economico, sono i moduli `search`, `attention`, `economy` a leggere dal tuo `index.ts`: aggiungi lì una lettura, non il contrario.

### Una migrazione

1. Modifica lo schema in `src/platform/db/schema/*.ts` (mai `auth.ts` a mano: `pnpm auth:schema`, e tieni allineate le opzioni in `scripts/auth-cli-config.ts`).
2. `pnpm db:generate`. Rivedi il file SQL creato in `drizzle/` (e il relativo snapshot in `drizzle/meta/`): le migrazioni sono **additive** (non esistono migrazioni «giù»).
3. Per SQL che Drizzle non genera (trigger, funzioni, dati di partenza): `pnpm exec drizzle-kit generate --custom --name=<nome>` crea un file vuoto da riempire a mano; separa le istruzioni con `--> statement-breakpoint`, come in `drizzle/0001_audit_chain.sql`.
4. Verifica: `pnpm exec drizzle-kit generate` dice «No schema changes»; `pnpm test` applica le migrazioni vere su PGlite.
5. In produzione, **prima** di pubblicare il codice che la richiede: backup, poi `pnpm db:migrate` ([`docs/RUNBOOK.md`](docs/RUNBOOK.md) §4).

### Un messaggio dell'interfaccia

Ogni testo visibile sta in `app/messages/it.json` (solo italiano). Le chiavi sono tipizzate (`src/global.d.ts`): un refuso non compila.

1. Aggiungi la chiave nello spazio dei nomi della sezione (o creane uno di primo livello con un nome unico).
2. Nel server: `const t = await getTranslations("ambito"); t("chiave")`; nel client: `useTranslations("ambito")`.
3. **Le chiavi non possono contenere punti**: next-intl legge il punto come percorso annidato. Per raggruppare, annida gli oggetti (`"detail": { "title": "…" }` → `t("detail.title")`).
4. Scrivi gli accenti veri (è, à) e gli apostrofi normali: è JSON, non serve escape.
5. `tests/messages.test.ts` fallisce se una chiave usata nel codice non esiste; `tests/neutral-language.test.ts` controlla il testo (§8).

### Una pagina con controllo accessi

1. File `app/src/app/(app)/<percorso>/page.tsx` (l'area `(app)` è quella riservata).
2. **La prima riga della funzione è `await requireOwner();`** (`@/platform/auth/owner`): il controllo nel layout è solo ottimistico. `tests/authz.test.ts` fallisce se una pagina di `(app)` non lo chiama.
3. Tipi dei parametri: `PageProps<"/percorso/[id]">`, generati da `next typegen` (lo lancia `pnpm typecheck`). Un `id` si valida con `isUuid` (`@/lib/ids`) e, se non c'è l'oggetto, `notFound()` (la pagina risponde 404 in italiano).
4. Titolo con `generateMetadata` e `getTranslations`. Una tabella larga va dentro `ScrollRegion` (`src/components/scroll-region.tsx`).
5. Se la schermata si raggiunge senza dati particolari, aggiungila all'elenco `PAGES` di `e2e/support/pages.ts` (verrà controllata per accessibilità a 1280 e 390 px e per il linguaggio neutro). **Non aggiungere un `loading.tsx` a livello `(app)`** (§ trappole).
6. Le **azioni del server** stanno in un `actions.ts` che inizia con `"use server"`: ogni funzione esportata verifica la sessione (`requireOwner()`, oppure l'helper `ownerAction`/`ownerActionWithValue` di `src/lib/owner-action.ts`, che apre anche la transazione con l'audit e ricarica i percorsi). Esporta **solo funzioni async** (e tipi): `tests/authz.test.ts` lo controlla.

### Una route API

1. File `app/src/app/api/<percorso>/route.ts` con la funzione del metodo (`GET`…). Per i parametri di percorso `RouteContext<"/api/…/[id]">`.
2. Come prima cosa: `const owner = await getOwnerForApi(); if (!owner) return new NextResponse(null, { status: 401 });` (`tests/authz.test.ts` lo impone, salvo auth, cron e health).
3. Un `id` che non è un UUID: 404. Per i file: `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Disposition`.
4. Un CSV si costruisce con `src/shared/csv.ts` (neutralizza le formule); un calendario con `src/shared/ics.ts`.
5. **Descrivila in `docs/API.md`** (percorso del file, metodo, autenticazione, parametri, risposta, codici): `tests/docs-routes.test.ts` fallisce altrimenti.
6. Un controllo in e2e: 401 senza sessione e il caso felice (`page.request` con `STORAGE_STATE`).

### Uno spec e2e

File `app/e2e/<area>.spec.ts`, uno per area.

1. **Un indirizzo `x-real-ip` distinto per file**: Better Auth conta le richieste per IP e i limiti di frequenza non devono sommarsi fra file.
   ```ts
   test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(N) } });
   ```
   (`clientIp` e `STORAGE_STATE` vengono da `e2e/support/env.ts` e `e2e/support/secrets.ts`). Scegli un numero **non usato** nella tabella qui sotto e aggiungilo.
2. I file girano in ordine alfabetico sullo stesso database in memoria: **ripulisci ciò che inserisci** (di solito con `pg` diretto su `E2E_DATABASE_URL`, come in `e2e/economy.spec.ts`), altrimenti rompi gli stati vuoti degli altri file. Fa eccezione il registro di audit, append-only. Chiudi sempre il client `pg` (`finally { await client.end() }`): con `DATABASE_POOL_MAX=1` e 2 connessioni del socket una connessione lasciata aperta blocca tutto.
3. Accessibilità: `a11yViolations(page)` (`e2e/support/a11y.ts`).
4. Per le richieste senza sessione usa un contesto con `storageState: { cookies: [], origins: [] }` e un suo indirizzo (vedi `e2e/deadlines.spec.ts`).
5. Lancialo: `pnpm exec playwright test e2e/<area>.spec.ts`.

Indirizzi `x-real-ip` già usati (`198.51.100.N`, da `e2e/*.spec.ts` e `e2e/auth.setup.ts`):

| N | File |
|---|---|
| 10 | `e2e/auth.setup.ts` |
| 20–26 | `e2e/auth.spec.ts` (un numero per ogni gruppo di test) |
| 30 | `e2e/shell.spec.ts` |
| 40 | `e2e/registry.spec.ts` |
| 50, 51 | `e2e/documents.spec.ts` |
| 60, 61, 62 | `e2e/backup.spec.ts` |
| 70, 71 | `e2e/rules.spec.ts` |
| 80, 81 | `e2e/deadlines.spec.ts` |
| 90, 91 | `e2e/matters-sharing.spec.ts` |
| 100 | `e2e/condominium.spec.ts` |
| 110 | `e2e/taxes.spec.ts` |
| 120 | `e2e/maintenance.spec.ts` |
| 130 | `e2e/insurance.spec.ts` |
| 140 | `e2e/lettings.spec.ts` |
| 150 | `e2e/neutral-language.spec.ts` |
| 160 | `e2e/accessibility-responsive.spec.ts` |
| 170 | `e2e/pagination.spec.ts` |
| 180 | `e2e/problem-pages.spec.ts` |
| 190 | `e2e/economy.spec.ts` |
| 200 | `e2e/attention.spec.ts` |
| 210 | `e2e/search.spec.ts` |
| 220 | `e2e/calendar.spec.ts` |
| 230 | `e2e/audit-log.spec.ts` |
| 240 | `e2e/health.spec.ts` |
| 250, 253, 254 | `e2e/security-page.spec.ts` |
| 260–263 | `e2e/web-polish.spec.ts` |
| 280 | `e2e/bulk-upload.spec.ts` |

## 5. Node 25 in locale, Node 24 per `pnpm arch`

Il runtime del progetto è Node 24 (come Vercel). Se in locale hai Node 25, l'app, i test e i build funzionano, ma **dependency-cruiser non lo supporta**: `pnpm arch` fallisce. Usa Node 24 (nvm-windows, fnm, Volta) oppure:

```bash
npx -y node@24 node_modules/dependency-cruiser/bin/dependency-cruiser.mjs src --config .dependency-cruiser.cjs
```

## 6. Migrazioni e CI

La CI (`.github/workflows/ci.yml`) esegue, nell'ordine: tipi, lint, confini, «migrazioni allineate allo schema» (`drizzle-kit generate` e fallisce se compaiono modifiche in `drizzle/`), test su PGlite, test su Postgres 17 reale, e in un secondo lavoro gli e2e sulla build di produzione. **La pipeline non è mai girata**: non c'è ancora un repository remoto (vedi `DECISIONS.md`).

## 7. Regole del progetto

- **Ogni scrittura passa da `runInUnitOfWork`** (direttamente o con `ownerAction`): modifica e riga di audit nella stessa transazione. L'audit registra **solo nomi** di azioni e di campi, identificativi e conteggi, **mai valori**.
- I moduli si parlano **solo** tramite i loro `index.ts`. Il dominio non importa framework, ORM o driver. Nessun nome di Comune o Regione nel codice (sono dati).
- Una sola lingua: **italiano** per interfaccia, commenti e documentazione (identificatori in inglese; E9).
- Non riscrivere ciò che esiste: controlla `docs/REGISTRO_CODEBASE.yaml` (moduli, utility, pattern) prima di scrivere una funzione.
- Non memorizzare mai credenziali di terzi (SPID, Entratel, portali) né segreti nel codice o nei log; negli errori compaiono i nomi delle variabili, non i valori.

## 8. Linguaggio neutro

L'app **organizza e ricorda**: non è consulenza legale, fiscale o tecnica e non attesta nulla. Quindi **non afferma mai** che un immobile sia conforme o in regola, che un tributo non sia dovuto, che una delibera sia valida o non valida, che un'attività si possa avviare. Dice solo **cosa risulta dai dati inseriti** («pagamenti pari all'importo indicato», «regola non verificata», «da rivedere»).

Il controllo è automatico (`tests/neutral-language.test.ts`, `tests/helpers/neutral.ts`, `e2e/neutral-language.spec.ts`):

- Verdetti affermativi (es. «è in regola», «è conforme», «è valida», «puoi avviare», «tutto in regola») sono ammessi solo in una frase **negata o condizionale** (con «non», «mai», «né», «se», «eventuale»…): «l'app non dice se l'attività è in regola» passa.
- Alcune frasi sono vietate **anche se negate** («non è dovuto», «non sei tenuto», «nessun obbligo», «non devi pagare»).
- Il test legge tutti i messaggi, tutte le stringhe del codice che l'utente può leggere e le schermate vere.

Se il test segnala la tua frase, riscrivila descrivendo il dato («risultano 2 pagamenti per 400,00 €») invece del giudizio.

## 9. Trappole note

- **`loading.tsx` a livello `(app)`**: non aggiungerlo. Con quel file `notFound()` risponde HTTP **200** invece di 404 (scoperto dall'e2e del registro, E50; lo guarda `e2e/problem-pages.spec.ts`). Se serve uno stato di caricamento, mettilo più in basso, vicino a una sezione.
- **Chiavi next-intl con punti**: il punto è un separatore di percorso; una chiave «a.b» non è una chiave ma un oggetto `a` con `b`.
- **`"use server"`**: un file con quella direttiva espone come endpoint tutto ciò che esporta, quindi può esportare **solo funzioni async** (e tipi). Niente costanti o oggetti esportati: stanno in un altro file (vedi `document-form-state.ts`, `asset-form-state.ts`). Lo controlla `tests/authz.test.ts`.
- **Vocabolario per i componenti client**: un file con `"use client"` non può importare l'`index.ts` di un modulo, né `platform`, né leggere `process.env`: porterebbe database e storage nel browser (E18; `tests/client-boundary.test.ts`). Usa `modules/<m>/client.ts`.
- **Il typecheck di `next build` include `tests/` ed `e2e/`** (`tsconfig.json` ha `**/*.ts`): un test scritto male fa fallire la build di produzione, e quindi gli e2e e il deploy. Tipizza i test come il resto.
- **Node 25 locale vs Node 24**: `pnpm arch` richiede Node 24 (§5).
- **PGlite non è Postgres**: nello sviluppo e negli e2e il pool va a 1 connessione (`DATABASE_POOL_MAX=1`), il socket regge 2 connessioni; il vero comportamento concorrente dell'audit si prova solo con `TEST_DATABASE_URL`. I test rifiutano database il cui nome non contiene «test».
- **Singleton su `globalThis`**: `getDb()` e `getAuth()` non usano variabili di modulo, perché Next/Turbopack può istanziare lo stesso modulo più volte e ognuna aprirebbe un proprio pool (E5). Non «semplificarli».
- **CSP con nonce → rendering dinamico**: il layout radice ha `dynamic = "force-dynamic"` (E4). Togliendolo, la build prerenderizza le pagine con query vere e le abortisce a metà.
- **Un'azione o una route senza `requireOwner()`/`getOwnerForApi()`** non passa i test (`tests/authz.test.ts`): il proxy e il layout non bastano.
- **`next build` valuta i moduli prima che l'ambiente esista**: le variabili d'ambiente si leggono al primo uso (`getServerEnv()`…), mai a livello di modulo.
- **Una tabella nuova senza backup** fa fallire `tests/backup.test.ts` (§4, modulo).
- **File condivisi e lavoro in parallelo**: `messages/it.json`, `package.json` e simili si modificano con modifiche mirate, non riscrivendoli per intero.
- **`pnpm.auditConfig.ignoreGhsas`** in `package.json` esclude una sola vulnerabilità nota, con il motivo in `DECISIONS.md` (E58): non aggiungerne altre senza una decisione.
