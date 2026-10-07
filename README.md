# Gestione Immobili

App web **personale** per organizzare gli immobili in Italia: dossier, documenti, scadenze, condominio, tributi, manutenzioni, assicurazioni, locazioni e rapporti con i professionisti. Un solo utente (il proprietario); avvocato, notaio, commercialista, tecnici, agenti e uffici sono contatti in rubrica, senza accesso. L'interfaccia è in italiano.

> L'app organizza e ricorda. Non fornisce consulenza legale, fiscale o tecnica e **non attesta mai** la conformità di un immobile, che un tributo non sia dovuto, che una delibera sia valida o che un'attività si possa avviare: dice solo cosa risulta dai dati inseriti. Un test automatico controlla che nessun messaggio affermi il contrario.

## Cosa fa

| Area | Contenuto |
|---|---|
| Immobili e rubrica | Beni e pertinenze con titolarità e quote, catasto a storico, collegamenti dichiarati; contatti con più ruoli |
| Documenti | Versioni, categorie, ricerca anche nel testo dei PDF, avviso duplicati, caricamento multiplo |
| Regole e dossier | Regole versionate come **dati** (con fonte e stato di verifica); dossier per bene con la spiegazione di ogni voce |
| Scadenze e avvisi | Date da regole o scritte a mano, prove, avvisi in app ed email, calendario `.ics` |
| Condominio, tributi, manutenzioni, assicurazioni, locazioni | Moduli completi, senza aliquote né interpretazioni: gli importi e le condizioni li scrive il proprietario |
| Pratiche e condivisione | Richieste, pareri, pacchetti ZIP per il professionista con registro |
| Viste per figura professionale | Schede e riepiloghi stampabili o in CSV per avvocato, notaio, tecnico, agente, amministratore, commercialista, impiantista, assicuratore, gestore e uffici |
| Quadro economico, «Da controllare», ricerca globale | Riepiloghi dei dati registrati e fatti ricavati dai dati, senza verdetti |
| Sicurezza e operatività | Passkey + TOTP, registro delle modifiche a catena di hash, backup cifrati, `pnpm doctor`, controllo di salute |

## Stato

Tutti gli incrementi del piano sono costruiti e verificati in locale. Cron giornaliero, email degli avvisi, rilascio su Vercel, adattatori Blob/S3 per documenti e backup e secondo fornitore di backup sono **scritti o previsti ma non provati su servizi reali** (servono gli account). Il dettaglio onesto di cosa è provato e cosa no è in [DECISIONS.md](DECISIONS.md) e [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Drizzle ORM su Postgres (PGlite nei test e in sviluppo) · Better Auth (passkey, TOTP) · next-intl · Tailwind 4 e shadcn/ui · Vitest · Playwright · dependency-cruiser · knip.

Monolite modulare: `src/modules/<modulo>/{domain,application,infrastructure}` con interfaccia pubblica in `index.ts`; i confini sono verificati in CI.

## Avvio rapido

Servono Node 24 e pnpm 10. Dalla cartella `app/`:

```bash
pnpm install
cp .env.example .env.local   # compila i valori (vedi app/README.md)
pnpm dev:db                  # terminale 1: database locale (PGlite) su 127.0.0.1:54320
pnpm dev                     # terminale 2: http://localhost:3000
```

Alla prima apertura l'app porta alla configurazione iniziale (token monouso, poi TOTP e passkey). Istruzioni complete, comandi e procedura di rilascio: [app/README.md](app/README.md).

## Verifiche

```bash
pnpm check                   # tipi, lint, confini tra moduli, codice morto, test unitari
pnpm exec playwright test    # e2e sulla build di produzione (accessibilità WCAG A/AA inclusa)
pnpm doctor                  # diagnosi dell'installazione
```

## Documentazione

| Documento | Contenuto |
|---|---|
| [app/README.md](app/README.md) | Avvio, comandi, backup, rilascio, controlli automatici |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Livelli, moduli, percorso di scrittura e audit, modello di accesso |
| [docs/API.md](docs/API.md) | Le route `/api`: accesso, parametri, risposte |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Manuale operativo: backup, ripristino, migrazioni, accesso perso |
| [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) | Revisione di sicurezza indipendente e stato delle correzioni |
| [SECURITY.md](SECURITY.md) | Modello di minaccia e limiti |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Come si lavora sul codice e si aggiunge un modulo |
| [CHANGELOG.md](CHANGELOG.md) | Cronologia delle modifiche |
| [DECISIONS.md](DECISIONS.md) | Le scelte prese e il perché |
| [docs/REGISTRO_CODEBASE.yaml](docs/REGISTRO_CODEBASE.yaml) | Mappa di moduli, utility e pattern |

I requisiti di partenza sono in [Prompt finale - App gestione immobili.md](<Prompt finale - App gestione immobili.md>) e [Prompt applicativo per la gestione di immobili in Italia.md](<Prompt applicativo per la gestione di immobili in Italia.md>).

## Licenza

Nessuna licenza è stata scelta: finché non ne viene aggiunta una, tutti i diritti restano riservati all'autore.
