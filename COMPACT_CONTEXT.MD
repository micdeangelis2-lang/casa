# COMPACT CONTEXT - GESTIONE IMMOBILI

> **Sintesi ad alta densità informativa della codebase per ottimizzazione del contesto LLM.**
> Riferimento rapido all'architettura, schemi dati, API e pattern strutturali estratti dall'analisi e dal grafo semantico (`graphify`).

---

## 1. Architettura & Stack Tecnologico

- **Tipo Progetto:** Monolite Modulare Web Full-Stack (Next.js App Router).
- **Frontend / UI:** Next.js 16.3.8, React 19.2.8, Tailwind CSS v4, Lucide React, Radix UI primitives, `shadcn/ui`, `next-intl` (internazionalizzazione IT).
- **Backend & Logica:** Next.js Server Components & Server Actions (`ownerAction()`), API Routes in `app/src/app/api/`.
- **Database & ORM:** Drizzle ORM 0.45.3 su PostgreSQL; in locale e test @electric-sql/pglite 0.5.8.
- **Autenticazione & Sicurezza:** Better Auth 1.7.7 con Passkey (WebAuthn) e TOTP 2FA. Modello proprietario singolo (`requireOwner()`), audit log con concatenazione hash crittografica (HMAC/SHA-256).
- **Testing & Qualità:** Vitest 5.0.3 (92 file, 738 test superati), Playwright 1.63 (E2E & WCAG A/AA), dependency-cruiser, knip, ESLint 9.
- **Punto di Ingresso Primario:**
  - Pagine Web: `app/src/app/(app)/page.tsx` (Dashboard) e `app/src/app/(app)/layout.tsx`.
  - Database Client: `app/src/platform/db/client.ts` (`getDb()`).
  - Unit of Work: `app/src/platform/db/unit-of-work.ts` (`runInUnitOfWork()`).

---

## 2. Core Abstractions & "God Nodes" (Graphify Analysis)

Dall'estrazione semantica del grafo (`17,104 nodi`, `28,228 archi`, `711 community`):

1. **`getDb()`** (*325 connessioni*): Fornisce l'istanza Drizzle ORM configurata (Postgres/PGLite).
2. **`isUuid()`** (*301 connessioni*): Validazione rigorosa degli identificativi univoci su tutte le route e azioni.
3. **`requireOwner()`** (*271 connessioni*): Guard obbligatoria che verifica identità e completamento sicurezza (Passkey + TOTP).
4. **`failGeneral()`** (*186 connessioni*): Standardizzazione risposte di errore applicative e di validazione.
5. **`runInUnitOfWork()`** (*167 connessioni*): Esecuzione transazionale multi-tabella con emissione automatica di eventi audit.
6. **`ownerAction()`** (*133 connessioni*): Wrapper per Server Actions protette da verifica proprietario e validazione Zod.
7. **`parseInput()`** (*112 connessioni*): Parsing e sanitizzazione Zod per input utente e parametri.
8. **Componenti UI Fondamentali**: `buttonVariants`, `Button()`, `Badge()`.

---

## 3. Mappa Moduli Applicativi (`app/src/modules/`)

Ogni modulo segue la separazione: `domain/` (entità e logica pura), `application/` (casi d'uso e orchestration), `infrastructure/` (query Drizzle e repository), ed esporta la sua API pubblica in `index.ts`.

| Modulo | Responsabilità Principale |
|---|---|
| `assets` | Gestione fabbricati, terreni, pertinenze, quote di proprietà e dati catastali storicizzati. |
| `directory` | Rubrica contatti unificata (professionisti, fornitori, inquilini, uffici) senza accesso diretto. |
| `documents` | Archiviazione, versionamento documenti, estrazione testo PDF (`unpdf`), rilevamento duplicati. |
| `deadlines` | Scadenze legali/amministrative, ricorrenze, generazione eventi calendario `.ics`. |
| `condominium` | Gestione stabili, tabelle millesimali, rate condominiali, verbali, delibere, sinistri e lavori. |
| `lettings` | Contratti di locazione, canoni, adeguamenti ISTAT, cauzioni, rendiconti entrate. |
| `taxes` | Tributi immobiliari (IMU, TARI, cedolare secca), scadenze F24 e prospetti riepilogativi. |
| `maintenance` | Registro interventi ordinari/straordinari, libretti impianto, preventivi e fatture. |
| `insurance` | Polizze fabbricato/contenuto, scadenze premi, massimali, franchigie e sinistri. |
| `matters` & `engagements` | Pratiche legali/tecniche e incarichi affidati a professionisti con storico. |
| `dossier` | Fascicolo immobiliare strutturato aggregato per vendita, locazione o conformità. |
| `notary` / `agent` / `offices` | Viste e schede specializzate esportabili per notaio, agente immobiliare e uffici pubblici. |
| `rules` | Motore di regole e requisiti normativi versionati come dati (senza pareri vincolanti). |
| `economy` | Quadro economico di sintesi, flussi di cassa, costi e ricavi aggregati. |
| `attention` | Dashboard "Da controllare": rilevamento incongruenze, scadenze imminenti e lacune documentali. |
| `backup` | Generazione backup cifrati (`.gibk`), chiavi asimmetriche, ripristino e export ZIP in chiaro. |
| `search` | Ricerca full-text unificata su asset, documenti e metadati. |
| `sharing` | Generazione pacchetti ZIP per condivisione con professionisti esterni. |

---

## 4. Endpoints HTTP & Route API (`app/src/app/api/`)

Tutte le route richiedono `getOwnerForApi()` (tranne `auth`, `cron` e `health`) e bloccano richieste cross-site (`Sec-Fetch-Site: same-origin`).

| Metodo e Indirizzo | Scopo / Payload | Formato Risposta |
|---|---|---|
| `GET`/`POST /api/auth/[...all]` | Gestione autenticazione Better Auth (Passkey, TOTP, sessioni) | JSON |
| `GET /api/health` | Controllo salute sistema (liveness/readiness, DB test) | JSON (`status: ok`) |
| `GET /api/territori` | Lookup codici catastali, comuni e province ISTAT | JSON |
| `GET /api/cron/backup` | Esecuzione schedulata backup di sicurezza (`CRON_SECRET`) | JSON |
| `GET /api/cron/giornaliero` | Ciclo giornaliero avanzamento scadenze e controlli | JSON |
| `GET /api/backup/[id]` | Download archivio cifrato | File binario `.gibk` |
| `GET /api/esportazione` | Esportazione integrale dati e documenti in chiaro | Archivio `.zip` |
| `GET /api/calendario` | Feed calendario scadenze immobile | File `.ics` |
| `GET /api/documenti/[id]/[versionId]` | Download stream file documento protetto | Binario con MIME type originale |
| `GET /api/condivisione/[id]` | Download pacchetto documentale condiviso | Archivio `.zip` |
| `GET /api/condominio/controllo` | Esportazione verifica pagamenti e rate condominiali | CSV (`;`, BOM UTF-8) |
| `GET /api/pratiche/[id]/cronologia` | Esportazione storico eventi pratica | CSV |
| `GET /api/economia` | Quadro economico e transazioni registrate | CSV |
| `GET /api/economia/dossier` | Prospetto economico per dossier immobile | CSV |
| `GET /api/locazioni/rendiconto` | Rendiconto locazioni e canoni riscossi | CSV |
| `GET /api/tributi/riepilogo` | Prospetto imposte e tributi versati/dovuti | CSV |
| `GET /api/immobili/[id]/scheda-tecnica` | Scheda tecnica descrittiva per tecnici/geometri | CSV |
| `GET /api/immobili/[id]/scheda-notaio` | Scheda immobile per atto notarile | CSV |
| `GET /api/immobili/[id]/scheda-agente` | Scheda riepilogativa per agenzia immobiliare | CSV |
| `GET /api/manutenzioni/impianti` | Registro impianti e controlli di manutenzione | CSV |
| `GET /api/assicurazioni/per-immobile` | Riepilogo coperture assicurative per bene | CSV |
| `GET /api/importa/modello` | Template CSV per importazione guidata beni/dati | CSV |

---

## 5. Schema Dati Principale (`app/src/platform/db/schema/`)

- `auth.ts`: Utenti, sessioni, account, verifiche, passkeys (Better Auth).
- `registry.ts`: `assets` (immobili, terreni), `asset_units` (subalterni), `asset_ownership` (quote titolarità), `contacts` (rubrica con ruoli multipli), `cadastral_records` (storia dati catastali).
- `audit.ts`: `audit_log` (catena hash immutabile con HMAC-SHA256, payload prima/dopo, utente, IP, timestamp).
- `documents.ts`: `documents`, `document_versions`, `document_tags`, `document_links`.
- `deadlines.ts`: `deadlines`, `deadline_rules`, `deadline_alerts`.
- `condominium.ts`: `condominiums`, `condo_units`, `condo_installments`, `condo_meetings`, `condo_resolutions`, `condo_claims`.
- `lettings.ts`: `leases`, `lease_tenants`, `lease_payments`, `lease_adjustments`.
- `taxes.ts`: `tax_declarations`, `tax_payments`, `tax_installments`.
- `maintenance.ts`: `maintenance_jobs`, `plants` (impianti termici, elettrici, ecc.), `maintenance_quotes`, `invoices`.
- `insurance.ts`: `insurance_policies`, `policy_claims`, `policy_installments`.
- `matters.ts`: `legal_matters`, `matter_events`, `matter_links`.
- `engagements.ts`: `professional_engagements`, `engagement_milestones`.
- `backup.ts`: `backup_records`, `backup_keys`.

---

## 6. Stato di Esecuzione & Test

- **Vitest Unit/Integration:** 92/92 file di test superati (738 test passed).
- **Playwright E2E:** Build di produzione con test di accessibilità WCAG A/AA integrati in `e2e/`.
- **Indice Semantico Graphify:** Aggiornato con successo (`graphify update .`), report in `graphify-out/GRAPH_REPORT.md` e metadati in `graphify-out/graph.json`.
- **Cron Giornaliero:** Schedulato `0 10 * * *` per verifica aggiornamenti `agy` e `graphify`.
