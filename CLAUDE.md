# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

App web personale "Gestione Immobili" (un solo proprietario, Italia, interfaccia in italiano). Il codice sta in `app/`; alla radice ci sono documenti di progetto. Rispondi e scrivi testi per l'utente in italiano.

## Dove guardare prima
- `DECISIONS.md`: registro delle decisioni (E1–E87) con motivi e limiti. Prima di cambiare un comportamento, cerca qui perché è fatto così.
- `docs/REGISTRO_CODEBASE.yaml`: registro di moduli, utility e pattern. Va aggiornato dopo ogni modifica (blocco "📒 Aggiornamento Registro" nella risposta, come da istruzioni globali).
- `docs/ARCHITECTURE.md` (livelli, scritture, tabelle per modulo), `docs/API.md`, `docs/RUNBOOK.md`, `docs/SECURITY_REVIEW.md`, `app/README.md` (comandi e avvio).
- `app/CLAUDE.md` importa `app/AGENTS.md`: questo Next.js (16) ha differenze rispetto a quello noto; consulta `app/node_modules/next/dist/docs/` prima di scrivere codice di framework.

## Comandi (tutti da `app/`, pnpm 10, Node 24 LTS)
```bash
pnpm dev:db        # terminale 1: Postgres in-process (PGlite) su 127.0.0.1:54320, applica le migrazioni; chiudere con Ctrl+C
pnpm dev           # terminale 2: http://localhost:3000
pnpm check         # typecheck + lint + arch + knip + test (quanto gira in CI, tranne e2e)
pnpm test          # Vitest (PGlite in-process, niente Docker)
pnpm exec vitest run tests/<file>.test.ts        # un solo file; aggiungere -t "<nome>" per un solo test
pnpm test:coverage # soglie per livello in vitest.config.mts: il build fallisce se scendono
pnpm exec playwright test [e2e/<file>.spec.ts]   # e2e sulla build di PRODUZIONE (fa `pnpm build`, PGlite su 54329, porta 3100)
pnpm arch          # dependency-cruiser; richiede Node 24 (con Node 25: npx -y node@24 node_modules/dependency-cruiser/bin/dependency-cruiser.mjs src --config .dependency-cruiser.cjs)
pnpm knip          # codice morto; i tipi esportati non usati in index.ts sono noti (139) e non fanno fallire
pnpm db:generate   # nuova migrazione da src/platform/db/schema; `drizzle-kit` deve poi dire "No schema changes"
pnpm db:migrate    # applica le migrazioni (.env.local)
pnpm doctor        # controlla configurazione e ambiente
```
`pnpm build` esegue anche il typecheck di `tests/` ed `e2e/`.

## Architettura (monolite modulare)
- `src/modules/<modulo>/{domain,application,infrastructure}` + `index.ts` pubblico. `domain` è puro (niente framework, ORM, driver); `application` dipende da porte (`ports.ts`), non dagli adattatori; i moduli si parlano **solo** via `index.ts` dell'altro. Imposto da `.dependency-cruiser.cjs` e `tests/architecture.test.ts`. `src/platform` (db, auth, audit, config, clock) è trasversale e non conosce i moduli; `src/shared` è foglia.
- Schema Drizzle unico in `src/platform/db/schema/*` (un file per area, non sempre uguale al modulo: vedi tabella in `docs/ARCHITECTURE.md` §6). Ogni tabella è scritta da un solo modulo; le letture incrociate sono dichiarate in `tests/architecture-data.test.ts` (una nuova lettura fa fallire il test). Migrazioni additive in `app/drizzle/` (0000–0027). Ogni FK ha un indice (`tests/db-indexes.test.ts`); le tabelle nuove vanno in `BUSINESS_TABLES` (`src/modules/backup/domain/archive.ts`).
- Scritture: sempre `runInUnitOfWork` (`src/platform/db/unit-of-work.ts`): una transazione che include la riga di audit append-only a catena di hash, che contiene solo nomi, id e conteggi (mai contenuti). Le letture ricevono un `Db`.
- Accesso: `requireOwner()` / `getOwnerForApi()` in ogni pagina, azione e route (verificato da `tests/authz.test.ts`); layout e proxy sono solo ottimistici. Route di scarico con `rejectCrossSite()`; le azioni sensibili (esportazione, backup, sicurezza) richiedono riconferma recente (`/riconferma`, cookie HMAC di 10 minuti).
- UI: Next.js App Router (`src/app`, gruppi `(app)` e `(auth)`), next-intl con solo `it` (chiavi tipizzate in `messages/it.json`; una chiave con il punto è un percorso annidato), Tailwind 4 + shadcn/ui. Auth con Better Auth (passkey + TOTP + password di riserva); `src/platform/db/schema/auth.ts` è generato (`pnpm auth:schema`).
- Viste di sola lettura per figura professionale (notaio, tecnico, agente, gestione, uffici, incarichi) e pacchetti di condivisione: leggono dai moduli, non hanno tabelle proprie. `import` (CSV) riusa le funzioni `validate*Input` dei moduli, non duplica regole.

## Trappole note
- File: scrivere/modificare con Edit/Write in UTF-8. Script Python/bash con backslash (`\n`, `\u…`) corrompono il codice; in Python aprire con `encoding="utf-8", newline=""`.
- "use server": solo funzioni async esportate. Niente `loading.tsx` a livello `(app)`.
- Test su Postgres reale (CI): non asserire sottostringhe numeriche brevi su JSON con UUID.
- e2e: usare `Client` di `e2e/support/pg-client.ts` (non `pg`), `clickWhenHydrated` per azioni client, un `x-real-ip` diverso per file (`clientIp(n)`, prossimo libero 385); girano con `workers: 1`.
- Più agenti sullo stesso albero: modificare i file condivisi (`messages/it.json`, registro) solo con Edit, mai riscrivendoli; comandi pesanti (typecheck, build, playwright) uno alla volta.
- Il database di sviluppo dell'utente (`app/.pglite`) non va toccato senza ok; migrazioni e dati prodotti vanno provati su copia.

## Vincoli di prodotto e di processo
- L'app non afferma mai conformità, tributo non dovuto, delibera valida/invalida o attività avviabile: linguaggio neutro, controllato da test. Nessuna norma o modulistica reale nel codice; i dati normativi sono dati modificabili.
- Mai memorizzare credenziali di portali di terzi. Non stampare né gestire la chiave privata dei backup (la genera l'utente con `pnpm backup:keygen`); non creare l'account owner né stampare `OWNER_BOOTSTRAP_TOKEN`.
- Non eliminare file senza conferma esplicita; non eseguire `/init` o pubblicare su GitHub senza richiesta. Il push va fatto solo su conferma (repo `micdeangelis2-lang/casa`; l'account `gh` attivo può non avere permessi di scrittura: push one-off con il token dell'altro account).
- Commit con trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; descrizioni di PR con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
