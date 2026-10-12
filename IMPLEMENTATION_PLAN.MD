# IMPLEMENTATION PLAN - GESTIONE IMMOBILI

## 1. Visione & Obiettivi Tecnici
Sviluppo e mantenimento di un'applicazione web personale modulare per la gestione completa del patrimonio immobiliare in Italia (dossier, documenti, scadenze, tributi, locazioni, condominio, manutenzioni, perizie, sicurezza e privacy).
- **Architettura:** Monolite modulare Next.js 16 (App Router) con TypeScript rigoroso e confini architetturali verificati (`dependency-cruiser`).
- **Data Layer:** Drizzle ORM su Postgres (PGlite per sviluppo locale e testing rapido in-memory/file).
- **Security by Design:** Autenticazione biometrica Passkey (WebAuthn) + TOTP, crittografia end-to-end dei backup, append-only audit trail con catena di hash crittografica (HMAC/SHA-256).

---

## 2. Architettura & Suddivisione Sottosistemi

### [DevOps-Agent] Infrastruttura, CI/CD e Qualità
- Configurazione dell'ambiente di esecuzione su Node.js 24 + pnpm 10.
- Pipeline di controllo unificata: `pnpm check` (TypeScript, ESLint, dependency-cruiser, Knip, Vitest).
- Schedulazione cron per backup automatici, ciclo giornaliero scadenze e sincronizzazione grafi semantici (`graphify`).
- Docker / script di avvio PGLite e migrazioni automatiche (`drizzle-kit`).

### [Backend-Agent] Dominio, Database & API
- Moduli applicativi indipendenti con struttura Clean Architecture (`domain`, `application`, `infrastructure`).
- Transazioni ACID atomiche tramite `runInUnitOfWork` e registrazione eventi audit immutabili.
- Motore di regole dinamiche versionate (`modules/rules`) per determinazione automatica scadenze e adempimenti senza pareri legali/fiscali vincolanti.
- Generazione ed esportazione pacchetti ZIP/CSV per professionisti (notaio, geometra, commercialista, avvocato).
- Storage documentale cifrato con deduplicazione hash SHA-256 e parsing PDF (`unpdf`).

### [Frontend-Agent] UI, Accessibilità e UX
- Design system coerente basato su Radix UI, Tailwind CSS v4 e Lucide Icons con tema ad alto contrasto e dark mode.
- Internazionalizzazione completa in lingua italiana con `next-intl` e linguaggio neutrale/non assertivo (nessun verdetto legale automatico).
- Server Components e Server Actions con reattività immediata e optimistic updates.
- Conformità WCAG 2.1 A/AA verificata con Playwright e axe-core.

---

## 3. Fasi di Implementazione & Roadmap

### Fase 1: Setup, Inizializzazione & Graph Indexing (Completata)
- [x] Rilevamento stack (Next.js 16, React 19, Drizzle ORM, PGLite, pnpm).
- [x] Verifica dipendenze e passaggio di tutte le 92 test suite Vitest (738 test superati).
- [x] Generazione grafo semantico con `graphify` (17.104 nodi, 28.228 archi, 711 cluster).
- [x] Redazione di `COMPACT_CONTEXT.MD` per ottimizzazione memoria di contesto LLM.
- [x] Pianificazione job ricorrente cron per aggiornamenti Antigravity/graphify.

### Fase 2: Rafforzamento Monitoraggio & Operatività (In Corso)
- [ ] Integrazione allarmi proattivi per scadenze nel modulo `attention`.
- [ ] Verifica periodica dei backup autenticati (`.gibk`) con simulazione di restore tramite `pnpm doctor`.
- [ ] Validazione continua dell'integrità del registro di audit hash-chain.

### Fase 3: Rilascio Cloud & Adattatori Storage Esterni (Futura)
- [ ] Configurazione storage adapter S3 / Vercel Blob per archivio documenti e backup remoti.
- [ ] Setup provider SMTP transazionale per alert email su scadenze imminenti.
- [ ] Rilascio su ambiente di staging con test E2E Playwright eseguiti in CI/CD.
