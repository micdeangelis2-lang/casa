# GEMINI PERSISTENT MEMORY LOG - GESTIONE IMMOBILI

## 1. Profilo Progetto & Sintesi Architetturale
- **Applicazione:** Gestione Immobili (App web personale per organizzazione beni immobiliari in Italia).
- **Stack Principale:** Next.js 16.3.8 (App Router), React 19.2.8, TypeScript 5.9.3, Drizzle ORM 0.45 su Postgres / PGLite 0.5.8, Tailwind CSS v4, Better Auth 1.7.7, Vitest 5.0.3, Playwright 1.63.
- **Root Cartella Applicazione:** `d:\casa\app`
- **Politica di Accesso:** Utente unico proprietario (`requireOwner()`), autenticazione con Passkey + TOTP, protezione cross-site rigidissima (`Sec-Fetch-Site`).

---

## 2. Decisioni Architetturali Rilevanti (ADR Recap)
1. **Monolite Modulare:** La logica di business risiede in 25 moduli isolati in `app/src/modules/<modulo>/` con confini verificati da `dependency-cruiser`. L'interfaccia pubblica di ciascun modulo è unicamente `index.ts`.
2. **Affidabilità & Non Asseverazione:** Nessun messaggio applicativo fornisce verdetti o attestazioni legali/fiscali (controllato da test automatizzato `tests/neutral-language.test.ts`).
3. **Audit Trail a Catena Crittografica:** Ogni mutazione di stato emette un record in `audit_log` con HMAC/SHA-256 e verifica a catena per prevenire manomissioni o alterazioni dirette sul DB.
4. **Backup Autenticati & Cifrati:** Gli archivi `.gibk` usano cifratura asimmetrica/simmetrica e firma digitale del manifest. Nessun ripristino è consentito su schemi disallineati.

---

## 3. Registro Operazioni & Inizializzazione Graphify (Sessione 2026-10-08)
- **Procedura /init & global-init-graphify completata con successo:**
  - Verifica dello stack Node.js e dell'albero delle dipendenze via `pnpm`.
  - Esecuzione completa suite di test: **92 suite superate, 738 test passed**.
  - Esecuzione `graphify update .`: generato grafo con **17.104 nodi, 28.228 archi, 711 comunità**; report salvato in `graphify-out/GRAPH_REPORT.md`.
  - Creazione mappa ad alta densità informativa in `COMPACT_CONTEXT.MD`.
  - Pianificazione cronjob giornaliero (`0 10 * * *`) per aggiornamenti client e strumenti.
  - Creazione documentazione dinamica di progetto: `IMPLEMENTATION_PLAN.MD`, `TASKS.MD`, `GEMINI.MD`.

---

## 4. Guida di Contesto per le Prossime Sessioni
- Per qualsiasi consultazione su rotte, moduli o schemi, fare sempre riferimento prioritario a `COMPACT_CONTEXT.MD` o a `graphify-out/GRAPH_REPORT.md` prima di scansionare file sorgenti estesi.
- Non eseguire chiamate globali `pip` o alterazioni del registro di sistema. Usare sempre `pnpm` all'interno della directory `d:\casa\app`.
- Mantenere aggiornati `TASKS.MD`, `IMPLEMENTATION_PLAN.MD`, `GEMINI.MD` e `README.MD` ad ogni modifica significativa.
