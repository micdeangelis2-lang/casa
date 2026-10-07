# Stage A — Proposta di architettura

App web personale per la gestione di immobili in Italia.
Stato: **in attesa di approvazione**. Nessun codice applicativo è stato scritto.
Riferimenti: `Prompt finale - App gestione immobili.md` (requisiti fissi), `Prompt applicativo per la gestione di immobili in Italia.md` (origine).

Convenzioni: i nomi di entità e campi sono in inglese (come il codice); i termini giuridici italiani restano tra virgolette dove servono. Ogni decisione ha un ID (`D1`…) e diventerà una voce di `DECISIONS.md` all'approvazione.

---

## 1. Sintesi delle scelte

| Area | Proposta | Alternative valutate | Motivo |
|---|---|---|---|
| Struttura | **Monolite modulare** in TypeScript, con livelli domain / application / infrastructure | Microservizi; backend separato | Un solo utente: i microservizi aggiungerebbero solo costi. I confini tra moduli restano comunque verificabili (vedi §3). |
| Framework web | **Next.js 16 (App Router)**, React, TypeScript `strict` | Remix, SvelteKit | Supporto di prima classe su Vercel; Server Actions e route handler riusano lo stesso livello application. |
| Runtime | **Node.js 24 LTS** (quello di Vercel). In locale hai Node 25: fissare la versione con `engines` e un file `.nvmrc`. | — | Evitare differenze tra locale e produzione. |
| Database | **PostgreSQL su Neon** (da Vercel Marketplace), regione UE (Francoforte) | Supabase, Turso | Postgres dà ricerca full-text in italiano (`italian`), `pg_trgm`, vincoli e trigger. Neon ha ripristino a un istante passato (PITR) e branch per i test. |
| ORM e migrazioni | **Drizzle ORM** + `drizzle-kit`, migrazioni SQL versionate in repo | Prisma | Controllo diretto sull'SQL (trigger, indici, viste). Driver `pg` con pooler Neon: servono **transazioni interattive** (modifica + riga di audit nella stessa transazione), che il driver HTTP di Neon non offre. |
| File | **`StoragePort`** con un adattatore. Predefinito: **Vercel Blob privato**, caricamento diretto dal browser. | Bucket S3-compatibile in UE (AWS eu-south-1/eu-central-1, Cloudflare R2 UE) | Zero configurazione. Rischio: l'accesso privato di Blob è oggi in beta pubblica → spike obbligatorio nell'incremento 0 (D3). |
| Autenticazione | **Better Auth** con passkey (WebAuthn) + TOTP + codici di recupero, nel tuo database | Clerk (Marketplace), Auth0, Descope | Un solo utente: nessun servizio di identità esterno e nessun legame con un fornitore. Registrazione chiusa dopo il primo account (D4). |
| UI | **Tailwind + shadcn/ui**, tutto in italiano, stringhe esterne con `next-intl` (solo `it`) | MUI, Chakra | Accessibile di default; le stringhe esternalizzate richieste dal prompt. |
| Validazione | **Zod** condiviso tra form, Server Actions e regole | — | Una sola fonte di verità per i tipi. |
| Email | **`EmailPort`**, adattatore predefinito **Resend** (regione UE) con template React Email | Brevo, Postmark, AWS SES | Semplice e sostituibile. |
| Job | Tabella `job` nel database + `after()` per l'esecuzione immediata + **Vercel Cron** giornaliero per il recupero e le scadenze | Workflow DevKit, coda esterna | Nessuna dipendenza in più. Workflow DevKit resta l'opzione se arriveranno lavori lunghi (OCR massivo). |
| Ricerca | **Postgres FTS** (`italian`) + `pg_trgm` per titoli ed emittenti | Elasticsearch, Algolia | Nessun servizio aggiuntivo; i documenti non escono dal database. |
| Test | **Vitest** (+ `fast-check` per le regole), **Playwright** (e2e), Postgres reale in CI | Jest, Cypress | Vedi §10. |

---

## 2. Decisioni da approvare

| ID | Decisione | Default proposto | Impatto se cambia |
|---|---|---|---|
| D1 | Stack: Next.js + Postgres (Neon) + Drizzle | Come in §1 | Cambia tutto il piano tecnico |
| D2 | Monolite modulare con confini applicati da test | Sì | — |
| D3 | File su Vercel Blob privato, dietro `StoragePort`; passaggio a S3-compatibile se lo spike fallisce | Blob + spike | Sposta solo l'adattatore, non il dominio |
| D4 | Auth: Better Auth, passkey + TOTP, registrazione chiusa dopo il primo account | Sì | Alternativa: Clerk (più rapido, ma identità in un servizio esterno) |
| D5 | Cifratura a livello di applicazione per i documenti "altamente riservati" | **No** nella v1 (solo cifratura dei fornitori); eventuale incremento dedicato | La cifratura applicativa impedisce ricerca e anteprima su quei file |
| D6 | OCR | Estrazione del testo incorporato nei PDF sempre attiva; OCR locale (Tesseract, lingua `ita`) **disattivato di default**; nessun OCR in cloud | Un OCR in cloud manderebbe documenti sensibili a terzi |
| D7 | Link di condivisione a scadenza | **Rimandato** a fine progetto, dietro feature flag; nella v1 solo pacchetti ZIP | Un link pubblico apre una superficie d'attacco |
| D8 | Backup | PITR Neon + archivio cifrato giornaliero su un **secondo fornitore** + download manuale (§8) | Serve un secondo account di archiviazione |
| D9 | Ambiente di sviluppo | Branch Neon per sviluppo, Postgres come servizio in CI; niente Docker locale | — |
| D10 | Ordine di realizzazione (§11) | Per dipendenze, in 13 incrementi | — |

---

## 3. Architettura a moduli

```
D:\casa\app\
  src\
    modules\                    # un modulo = un dominio di business
      territory\  directory\  assets\  documents\  rules\  dossier\
      deadlines\  condominium\  taxes\  works\  insurance\
      lettings\  hospitality\  matters\  sharing\
        domain\                 # entità, regole pure, nessun I/O
        application\            # casi d'uso (transazione, audit, permessi)
        infrastructure\         # repository Drizzle, adattatori
        ui\                     # pagine, componenti, form
    platform\                   # porte e adattatori trasversali
      db\  storage\  auth\  email\  jobs\  clock\  audit\
    shared\                     # tipi, Zod, utility pure
  app\                          # route Next.js (sottili: chiamano i casi d'uso)
  drizzle\                      # migrazioni
  scripts\                      # seed, backup, ripristino
  tests\
```

Regole applicate in CI con `dependency-cruiser`:

- `domain` non importa nulla da `infrastructure`, `platform` o dal framework.
- Un modulo parla con un altro solo tramite la sua interfaccia pubblica (`index.ts`).
- Route Next.js, cron e script CLI chiamano **gli stessi** casi d'uso.
- **Test di architettura**: fallisce se i nomi `Sorrento`, `Meta`, `Campania` o un codice catastale compaiono fuori da `scripts/seed` e dai test.

Il tempo è sempre iniettato (`ClockPort`): il motore delle regole e le scadenze sono deterministici e testabili.

---

## 4. Modello dati

Convenzioni: chiavi UUIDv7; `created_at`/`updated_at` in `timestamptz`; **date di calendario** (scadenze, emissione) in tipo `date`; importi in **centesimi** (`bigint`) con valuta; quote come frazioni (`numerator`/`denominator`); millesimi come `numeric`; cancellazione logica (`deleted_at`) per tutto ciò che ha valore documentale. Ogni scrittura passa dal livello application, che scrive anche l'audit nella stessa transazione.

### 4.1 Territorio e rubrica
- `territory` — `kind` (country, region, province, municipality, locality), `parent_id`, `name`, `istat_code`, `cadastral_code`, validità. **Gerarchia a dati**: nessun Comune è nel codice.
- `office` e `portal_link` — ufficio competente per territorio e tipo di servizio, contatti, indirizzi dei portali istituzionali.
- `party` — rubrica (persona o ente) con `kind` (administrator, lawyer, accountant, notary, surveyor, technician, insurer, adjuster, agent, manager, supplier, public_office, tenant, other) e contatti.

### 4.2 Beni
- `asset` — `kind` (dwelling, detached_house, garage, box, parking, cellar, other), `use`, `territory_id`, indirizzo, `attributes` (JSONB validato da Zod: anno di costruzione, impianti presenti, ascensore, ecc.).
- `asset_link` — collegamento **dichiarato** tra bene accessorio e uno o più beni principali: `declared_basis`, `supporting_document_ids`, `validation_status`. Nessuna pertinenzialità presunta.
- `ownership_right` — `holder` (il proprietario o un co-proprietario in rubrica), `right_type` (full, co_ownership, usufruct, bare_ownership), quota, validità.
- `cadastral_record` — foglio, particella, subalterno, categoria, classe, consistenza, rendita, `valid_from`/`valid_to`. Storico, perché il catasto cambia.

### 4.3 Documenti
- `file_object` — chiave di storage, `sha256`, dimensione, MIME verificato sui byte (non sull'estensione).
- `document` (logico) e `document_version` — `version_no`, `file_object_id`, `issued_on`, `valid_from`/`valid_to`, `issuer_party_id`, `supersedes_document_id`, `verification_status`, `confidentiality`, testo estratto e `tsvector`.
- `document_category` — tassonomia **a dati** (categoria e sottocategoria).
- `document_asset` (n:n con i beni), `document_link` (collegamenti tra documenti e pratiche).
- **Duplicati**: `sha256` identico, oppure stessa terna (titolo, emittente, data di emissione) → avviso, mai blocco.

### 4.4 Regole, dossier, scadenze
- `rule` (identità stabile) e `rule_version` (**immutabile** una volta pubblicata): `level` (national, regional, municipal, condominium, contract), `territory_id` (o nullo = ovunque), `valid_from`/`valid_to`, `applies_when` (condizione, §5), `outcomes[]`, `source` (riferimento testuale e URL), `verification_status`, `supersedes_version_id`.
- `obligation_instance` — risultato della valutazione su un bene: chiave `(asset_id, rule_key, instance_key)`, `rule_version_id`, `explanation` (JSON), **stato scelto dal proprietario separato dalla derivazione**.
- `dossier_item` — voce del dossier: `category`, `status` ∈ {present, missing, requested, to_verify, expired, superseded, not_applicable, validated_by_professional}, documenti collegati, `obligation_instance_id` opzionale (voce manuale o derivata).
- `deadline` — `title`, `level`, `legal_basis`, `asset_id`, `responsible_party_id`, `due_on`, `calc` (regola di calcolo), `recurrence`, `priority`, `delay_consequences`, `notice_policy`, `status`, `completion_kind` ∈ {owner, auto_verified, professional_validated}.
- `deadline_proof` — documenti o riferimenti (protocollo, quietanza) che provano l'adempimento.
- `notification` — outbox con chiave univoca `(deadline_id, lead_time, due_on)`, così ogni avviso parte **una sola volta** anche se il cron gira due volte.

### 4.5 Moduli verticali
- **Condominio**: `condominium`, `condo_membership` (bene ↔ condominio), `millesimal_table` e `millesimal_share`, `condo_fiscal_year`, `condo_budget`, `condo_installment` (ordinaria/straordinaria), `condo_meeting`, `condo_agenda_item`, `condo_proxy`, `condo_resolution`, `condo_work`, `condo_claim`.
- **Tributi e pagamenti**: `tax_type` (a dati, per territorio), `tax_obligation` (bene, anno, importo atteso/pagato inseriti a mano), `payment` (data, importo, metodo, prova).
- **Manutenzioni**: `work_order`, `quote`, `invoice`, `warranty`, `inspection_plan`.
- **Assicurazioni**: `policy`, `coverage`, `premium`, `insurance_claim`.
- **Locazioni e ricettività** (moduli opzionali, attivati per bene dopo la scelta del tipo): `lease` (`kind`: ordinary, transitional, student, short_term), `occupant`, `lease_registration`, `rent_schedule_item`, `deposit`, `hospitality_registration` (codici identificativi per territorio e tipo), `tourist_tax_period`, `statistical_report`.
- **Pratiche**: `matter` (pratica), `matter_assignment` (assegna uno o più contatti), `matter_document_request`, `professional_opinion` con `nature` ∈ {informational, formally_validated}.

### 4.6 Condivisione e audit
- `share_package` + `share_package_item` + `share_log`: destinatario (tipo e nome), contenuto con `sha256` di ogni file, tetto di riservatezza, data.
- `audit_log` — **append-only**: nessun `UPDATE`/`DELETE` per il ruolo applicativo (permessi + trigger), colonne `actor`, `action`, `entity_type`, `entity_id`, `diff`, `at`, `prev_hash`/`hash` (catena di hash, per accorgersi di manomissioni).
- `app_setting`, `job`.

I collegamenti "vedi anche" tra entità diverse usano una tabella generica `entity_link`; dove serve integrità vera (documento ↔ scadenza, documento ↔ bene) ci sono tabelle di giunzione con chiavi esterne.

---

## 5. Motore delle regole

### 5.1 Principi
1. **Le regole sono dati**, non codice. Nessuna data, aliquota o scadenza futura è scritta nel software.
2. Una `rule_version` pubblicata non si modifica: ogni cambio crea una nuova versione. Si può **clonare, disattivare, confrontare** versioni dalla UI, con storico.
3. Ogni regola dichiara livello normativo, territorio, validità, fonte e **stato di verifica** (`draft`, `to_verify`, `verified_by_owner`, `validated_by_professional`). Gli esiti che derivano da regole non verificate mostrano un'etichetta visibile ("regola non verificata").
4. Le valutazioni sono **spiegabili**: per ogni voce l'app mostra quale versione di quale regola l'ha prodotta, quali condizioni sono risultate vere e quali fatti del bene sono stati usati.

### 5.2 Fatti e condizioni
- I **fatti** sono gli attributi del bene e del suo contesto: catena territoriale (Stato → Regione → Provincia → Comune), tipo di bene, uso, regime di titolarità, presenza di condominio, tipo di locazione attiva, attività ricettiva, caratteristiche tecniche (`attributes`), date di riferimento (acquisto, contratto, scadenza documenti).
- `applies_when` è un **albero JSON** limitato: `all` / `any` / `not` e confronti `eq`, `in`, `gte`/`lte`, `exists` su percorsi di fatti. Niente `eval` né codice arbitrario. Validato con Zod e modificabile in UI con un editor a moduli (non a testo libero).

### 5.3 Esiti
Un esito può essere: una **voce di checklist** (con documento atteso e categoria), una **scadenza** (con regola di calcolo) o un **avviso** ("da verificare con il professionista X").

### 5.4 Calcolo delle scadenze
`calc` è uno di questi tipi, tutti **relativi ad ancore** e mai a date assolute:
- `fixed_annual` (giorno/mese di ogni anno),
- `relative_to` (ancora + offset, es. "N giorni dopo la data del contratto"),
- `recurring` (ogni N mesi/anni da un'ancora),
- `manual`.

Lo spostamento al primo giorno lavorativo successivo è un **attributo della regola** (sì/no), con calendario dei festivi **a dati**. Il motore non decide da solo cosa sia "scadenza di legge".

### 5.5 Ciclo di valutazione
La valutazione gira al salvataggio del bene, alla pubblicazione di una regola e una volta al giorno. Produce una **differenza**: voci nuove, voci invariate, voci per cui la regola non vale più. Queste ultime **non vengono cancellate**: restano con l'etichetta "la regola non si applica più, da rivedere" e decide il proprietario. Lo stato scelto dall'utente non viene mai sovrascritto dal motore.

### 5.6 Contenuto iniziale
Un insieme **minimo e illustrativo**, tutto in stato `to_verify`: pochi documenti tipici di un appartamento in condominio e un esempio comunale. Serve solo a dimostrare il meccanismo. Il contenuto reale va confermato dal proprietario con un professionista.

---

## 6. Documenti e ricerca

- **Caricamento**: dal browser direttamente verso lo storage con token firmato a breve scadenza (aggira il limite del corpo delle richieste). A caricamento finito il server verifica i byte (tipo MIME reale, dimensione, `sha256`) e crea `file_object` e `document_version`. File non conformi vengono scartati.
- **Accesso**: mai URL pubblici. I file passano da una route autenticata che li trasmette in streaming (o da un URL firmato di pochi minuti).
- **Anteprima**: visualizzatore PDF e immagini del browser dentro la route autenticata; CSP restrittiva.
- **Ricerca**: testo incorporato nei PDF estratto in processo; `tsvector` con dizionario `italian`; `pg_trgm` per titoli ed emittenti; filtri per bene, categoria, stato, validità, riservatezza.
- **Hook antivirus**: esiste come interfaccia (`FileScanPort`) ma l'adattatore predefinito è vuoto. Un servizio esterno di scansione riceverebbe i tuoi documenti (D6): da decidere solo se lo vuoi.
- **Versionamento**: una nuova versione non cancella la precedente; "sostituisce" è un collegamento esplicito.

---

## 7. Sicurezza e privacy

| Tema | Misura |
|---|---|
| Accesso | Account unico; passkey + TOTP; codici di recupero; sessioni su database, brevi; **riautenticazione** per esportazioni, cancellazioni e creazione di pacchetti. |
| Primo avvio | Account creato con un token monouso (`OWNER_BOOTSTRAP_TOKEN`); dopo il primo account la registrazione è chiusa a livello di codice e di database. |
| Passkey e dominio | Le passkey sono legate al dominio: serve un **dominio di produzione stabile** (non l'indirizzo `*.vercel.app` delle anteprime). Le anteprime useranno un accesso di sviluppo separato. |
| Rete | Header di sicurezza, CSP con nonce, rate limiting con le regole del Vercel Firewall sulle rotte di autenticazione, ulteriore contatore di tentativi nel database. |
| Dati | Cifratura in transito e a riposo dei fornitori; regioni UE; segreti solo come variabili d'ambiente di Vercel; nessun segreto nel repository né nel bundle client. |
| Log | Log strutturati **senza dati personali** né contenuti dei documenti. |
| File | Allow-list di tipi, limiti di dimensione, controllo sui byte, nome file normalizzato, nessuna esecuzione di contenuti caricati. |
| Credenziali di terzi | **Mai** memorizzate (SPID, Entratel, portali). Solo collegamenti diretti. |
| Dati di terzi | Per inquilini e altri soggetti si raccoglie il minimo; ogni anagrafica ha un campo di conservazione. Se e come il GDPR si applichi alla tua attività di locatore è una valutazione da fare con un professionista: l'app non la dà per scontata. |
| Cifratura applicativa | Non nella v1 (D5). |

---

## 8. Esportazione, condivisione, backup

### Pacchetti documentali (sezione 10 del prompt)
- Si scelgono destinatario (tipo e nome), beni, categorie, documenti e **tetto di riservatezza**; l'app avvisa se un documento supera il tetto.
- Il file ZIP viene **generato in streaming** direttamente verso il browser, senza salvarne una copia: nessun duplicato sensibile in giro. Contiene l'indice (`INDEX.html`, con elenco e metadati), `manifest.json` e un CSV.
- Il `share_log` registra destinatario, contenuti e `sha256`.
- Limite noto: una funzione Vercel dura al massimo 300 s. Pacchetti molto grandi verranno **divisi in più parti**; il limite sarà misurato nell'incremento 6.

### Esportazione completa
NDJSON per tabella + file originali, con un manifest versionato dello schema. Serve a non restare vincolati.

### Backup (D8)
1. **Neon PITR** per il database (la finestra dipende dal piano: va verificata).
2. **Archivio giornaliero cifrato** su un secondo fornitore: dump logico di tutte le tabelle + copia incrementale dei file (indirizzati per `sha256`, quindi si copiano solo i nuovi). Cifratura con una chiave tenuta **fuori** da Vercel (la custodisci tu).
3. **Download manuale** dell'archivio dall'interfaccia, per una copia sul tuo disco.
4. **Ripristino**: script `scripts/restore` che ricostruisce database e file in un ambiente vuoto. È **testato in CI** a ogni modifica dello schema e va provato a mano prima di caricare documenti reali.

Finché il backup non è operativo (incremento 3), si usano solo dati di prova.

---

## 9. Notifiche e scadenze

- Un **cron giornaliero** (UTC, impostato per cadere al mattino in Italia) valuta le scadenze e inserisce nell'outbox gli avvisi dovuti. La chiave univoca li rende idempotenti.
- Canali: **in-app** (sempre) + **email**. Notifiche push (PWA) come estensione successiva.
- Ogni scadenza ha anticipi propri, possibilità di rinvio e **escalation** quando è scaduta (avviso ripetuto con frequenza crescente).
- Viste: calendario, elenco, per bene, per categoria, scadute, prossime.
- Le scadenze si chiudono con una **prova** quando la regola la richiede; lo stato distingue completata dall'utente, verificata automaticamente e validata da un professionista.

---

## 10. Qualità e test

| Livello | Strumento | Cosa copre |
|---|---|---|
| Unitari | Vitest | Dominio puro: stati, transizioni, calcolo delle scadenze, giorni lavorativi |
| Proprietà | `fast-check` | Il motore delle regole: determinismo, idempotenza, non sovrascrittura dello stato utente |
| Integrazione | Vitest + Postgres reale | Repository, transazioni con audit, trigger di append-only, ricerca full-text |
| Architettura | `dependency-cruiser` + test personalizzato | Confini tra moduli, nessun nome di territorio nel codice |
| End-to-end | Playwright | Flussi critici: accesso, creazione bene, upload, regola → checklist, scadenza → avviso, pacchetto, ripristino |
| Accessibilità | `axe` in e2e | Obiettivo WCAG 2.2 AA |
| Pipeline | GitHub Actions | lint, `tsc`, test, test di migrazione e di ripristino su ogni PR |

---

## 11. Piano di consegna per incrementi

Tutti i moduli hanno pari priorità; l'ordine segue le dipendenze. Ogni incremento gira in locale e su un'anteprima Vercel, ha test verdi in CI e una **dimostrazione** prima di passare al successivo. Le dimensioni sono relative: S, M, L.

| # | Incremento | Contenuto | Dim. |
|---|---|---|---|
| 0 | **Fondamenta** | Repo, CI, shell UI in italiano, database e migrazioni, auth a utente unico, audit con catena di hash, test di architettura, anteprima Vercel. **Spike**: regione e stato di Blob privato, limiti del cron e delle funzioni sul tuo piano, passkey sul dominio scelto. | M |
| 1 | **Territori, rubrica, beni** | Gerarchia territoriale (con seed Piano di Sorrento, Meta, Campania e **import** dell'elenco ufficiale ISTAT), uffici e portali, rubrica, beni, diritti e quote, collegamenti dichiarati, storico catastale. | L |
| 2 | **Documenti** | `StoragePort`, upload diretto, versioni, metadati, duplicati, tassonomia, ricerca, anteprima. | L |
| 3 | **Backup e esportazione completa** | Archivio cifrato, secondo fornitore, ripristino testato, export strutturato. Da qui si caricano documenti reali. | M |
| 4 | **Regole, dossier, checklist** | Editor delle regole, valutazione con spiegazione, differenze, stati del dossier, completezza senza giudizi di conformità. | L |
| 5 | **Scadenze e notifiche** | Calcolo, ricorrenze, prove, cron, outbox, email e in-app, viste. | L |
| 6 | **Pratiche e condivisione** | Pratiche, assegnazioni, pareri (informativo/validato), pacchetti ZIP, registro delle condivisioni. | M |
| 7 | **Condominio** | Anagrafiche, millesimi, esercizi, rate, assemblee, delibere, lavori, sinistri; preparazione dell'assemblea e controllo delle decisioni. | L |
| 8 | **Tributi e pagamenti** | Tipi di tributo a dati, obblighi per anno, pagamenti con prova, passaggio al commercialista. | M |
| 9 | **Manutenzioni e assicurazioni** | Interventi, preventivi, garanzie, ispezioni; polizze, premi, sinistri. | M |
| 10 | **Locazioni e ricettività** | Moduli opzionali per tipologia, contratti, registrazione, canoni, codici identificativi, imposta di soggiorno, statistiche. | L |
| 11 | **Avvisi di prodotto** | Tutti i limiti della sezione 12 del prompt resi visibili nell'interfaccia, linguaggio neutro verificato in tutte le schermate. | S |
| 12 | **Consolidamento** | Audit di accessibilità, prestazioni su molti documenti, revisione di sicurezza, documentazione, link a scadenza (se confermato, D7). | M |

**Definizione di fatto** per ogni incremento: quella del §15 del prompt (esecuzione locale e su anteprima, test verdi, audit completo, nessun nome di territorio nel codice, `README.md`, `DECISIONS.md` e registro aggiornati).

---

## 12. Rischi

| Rischio | Probabilità | Mitigazione |
|---|---|---|
| Contenuto normativo sbagliato o datato | Alta | Regole come dati con fonte, validità e stato di verifica; seed minimo; avvisi in UI; revisione di un professionista. |
| Blob privato in beta | Media | Spike nell'incremento 0; adattatore S3-compatibile pronto dietro la stessa porta. |
| Limiti serverless (ZIP grandi, OCR) | Media | ZIP in streaming e a parti; OCR disattivato di default; Workflow DevKit se serve. |
| Perdita dati | Bassa, impatto alto | PITR + archivio su secondo fornitore + ripristino testato in CI. |
| Passkey legate al dominio | Media | Dominio di produzione stabile scelto prima dell'incremento 0. |
| Troppo ambizioso (14 moduli) | Alta | Incrementi verticali con dimostrazione; ogni modulo utile da solo. |
| Motore delle regole troppo complesso | Media | Linguaggio di condizioni volutamente piccolo; si estende solo su un caso reale. |
| Limiti del piano Vercel | Media | Verifica nello spike; il cron giornaliero basta al progetto. |

---

## 13. Ipotesi e domande aperte

**Ipotesi adottate** (modificabili):
- App in `D:\casa\app\`; i documenti di requisiti restano dove sono (`D:\casa\docs\` per le nuove).
- Una sola lingua nell'interfaccia (italiano), una sola valuta (EUR), un solo fuso (Europe/Rome).
- Stile grafico sobrio con shadcn/ui; un passaggio di design dedicato potrà venire dopo.
- I codici catastali e ISTAT vengono **caricati dalle fonti ufficiali**, non digitati a memoria, e restano `to_verify` fino a conferma.

**Mi servono da te prima dell'incremento 0:**
1. **Piano Vercel** (Hobby o Pro) e se hai già un account **GitHub** da usare per il repository privato.
2. **Dominio** da usare in produzione (anche solo un sottodominio): serve alle passkey.
3. **Volume previsto**: quanti beni e quanti documenti (e quanti GB) stimi, per dimensionare lo storage.
4. **Secondo fornitore per il backup**: hai già un account su un servizio di archiviazione, o preferisci solo la copia manuale sul tuo disco?
5. **Email** per le notifiche e preferenza sul fornitore (Resend UE è il default).
