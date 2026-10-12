# Guida al Deploy e Configurazione su Vercel

Questo documento riassume nel dettaglio tutte le azioni eseguite per portare in produzione l'applicazione **Gestione Immobili** su Vercel ([https://casa-os-one.vercel.app/](https://casa-os-one.vercel.app/)), partendo dagli errori iniziali (404 e 500) fino al funzionamento completo.

---

## 1. Risoluzione dell'errore iniziale: `404 NOT_FOUND`

### Sintomo
Accedendo all'URL del progetto (`https://casa-os-one.vercel.app/`), Vercel rispondeva con:
```text
This page doesn’t exist
404 NOT_FOUND
fra1::...
```

### Causa Tecnica
Nel repository Git, l'applicazione Next.js non si trova nella cartella principale (`/`), ma nella sottocartella `app/`:
```text
casa/
├── .github/
├── docs/
├── app/                  <-- Qui risiedono package.json, next.config.ts e src/
│   ├── package.json
│   └── src/
└── README.md
```
Vercel, importando il repository con impostazioni predefinite, cercava `package.json` nella root (`.`). Non trovandolo, trattava il progetto come sito statico generico senza file, con un tempo di build di 0 secondi (`Builds: . [0ms]`).

### Soluzione Applicata
Abbiamo aggiornato la configurazione del progetto Vercel `casa-os`:
- **Root Directory:** impostata a `app`
- **Framework Preset:** impostato a `nextjs`

Comando CLI utilizzato:
```bash
npx vercel project update casa-os --root-directory app --framework nextjs --yes
```

---

## 2. Risoluzione dell'errore: `500 Internal Server Error` (Variabili d'ambiente)

### Sintomo
Dopo aver corretto la Root Directory, la build di Next.js e' riuscita, ma all'apertura del sito la pagina restituiva un errore 500.

I log di Vercel (`vercel logs`) segnalavano:
```text
Error: Configurazione ambiente non valida:
BETTER_AUTH_SECRET (Input non valido: atteso string, ricevuto undefined);
BETTER_AUTH_URL (Input non valido: atteso string, ricevuto undefined)
```

### Causa Tecnica
Le variabili d'ambiente necessarie per l'autenticazione (`Better Auth`), per la sicurezza e per i cron non erano ancora state definite nel pannello di Vercel.

### Soluzione Applicata
Abbiamo iniettato le variabili d'ambiente necessarie su tutti i target (`Production`, `Preview`, `Development`):
- `BETTER_AUTH_URL`: `https://casa-os-one.vercel.app` (necessario per l'origine WebAuthn e i cookie di sessione).
- `BETTER_AUTH_SECRET`: stringa casuale crittografica a 32 caratteri.
- `OWNER_BOOTSTRAP_TOKEN`: token segreto monouso per autorizzare la `/configurazione-iniziale` del proprietario.
- `CRON_SECRET`: token per autorizzare le chiamate automatiche del cron job giornaliero definite in `vercel.json`.

Comandi CLI utilizzati:
```bash
npx vercel env add BETTER_AUTH_URL production,preview,development --value "https://casa-os-one.vercel.app" --yes
npx vercel env add BETTER_AUTH_SECRET production,preview,development --value "<segreto>" --yes
npx vercel env add OWNER_BOOTSTRAP_TOKEN production,preview,development --value "<token>" --yes
npx vercel env add CRON_SECRET production,preview,development --value "<segreto>" --yes
```

---

## 3. Provisioning Database Cloud: Neon Serverless Postgres

### Sintomo
Risolto Better Auth, i log di Vercel hanno evidenziato la mancanza del database:
```text
Error: Configurazione ambiente non valida:
DATABASE_URL (Input non valido: atteso string, ricevuto undefined)
```
In locale l'applicazione utilizzava un database PGlite in-process su socket `127.0.0.1:54320`. In ambiente serverless cloud su Vercel, `127.0.0.1` non esiste e non e' raggiungibile.

### Soluzione Applicata
1. **Integrazione Marketplace Vercel:**
   Abbiamo collegato **Neon** (Serverless Postgres) direttamente dal marketplace di Vercel, nella regione europea di Francoforte (`fra1` / `eu-central-1`):
   ```bash
   npx vercel integration add neon --name casa-db -m region=fra1 --plan free_v3
   ```
   Questa operazione ha generato e collegato automaticamente le variabili:
   - `DATABASE_URL` (connessione pooled per Serverless)
   - `DATABASE_URL_UNPOOLED` (connessione diretta)

2. **Applicazione delle Migrazioni Drizzle:**
   Una volta scaricata la stringa di connessione remota, abbiamo eseguito la migrazione dello schema completo (tutte le 28 migrazioni Drizzle per tabelle, vincoli, trigger e indici):
   ```bash
   pnpm db:migrate
   ```

3. **Popolamento iniziale dei territori ISTAT:**
   Abbiamo popolato il database con tutti i dati geografici ufficiali necessari all'applicazione:
   ```bash
   pnpm territory:import
   ```
   *(8.024 territori e Comuni italiani importati con successo).*

---

## 4. Modifica Requisito: Passkey Resa Opzionale

### Esigenza
In fase di onboarding su `/sicurezza/configurazione`, l'applicazione bloccava l'accesso finche' non veniva registrata obbligatoriamente almeno una passkey hardware/browser (`complete = totpDone && passkeys.length >= 1`).
L'utente ha richiesto che la passkey fosse **opzionale** (accesso con sola password + app di autenticazione TOTP).

### Modifiche nel Codice
1. **Controlli di autorizzazione server (`src/platform/auth/owner.ts`):**
   - Modificata la funzione `getOwnerSetup(userId)` per considerare il profilo completato quando `twoFactorEnabled` (TOTP) e' attivo, senza richiedere `passkeyCount >= 1`:
   ```typescript
   export async function getOwnerSetup(userId: string): Promise<OwnerSetup> {
     ...
     const twoFactorEnabled = user?.twoFactorEnabled === true;
     const passkeyCount = passkeys?.n ?? 0;
     return { twoFactorEnabled, passkeyCount, complete: twoFactorEnabled };
   }
   ```
2. **Interfaccia di configurazione (`src/app/(auth)/sicurezza/configurazione/security-setup.tsx`):**
   - Modificata la condizione di completamento a `const complete = totpDone`.
   - Il pulsante *"Vai alla panoramica"* compare immediatamente dopo aver convalidato l'app di autenticazione (TOTP), consentendo di proseguire subito.
3. **Traduzioni e testi (`messages/it.json`):**
   - Aggiornato il titolo della sezione in `"3. Passkey (opzionale)"`.
   - Aggiornata la descrizione indicando che la registrazione e' facoltativa.
4. **Verifica:**
   - Eseguito `pnpm check` (TypeScript, ESLint, dependency-cruiser, Knip e tutti i 740 test unitari e di integrazione passati con successo).
   - Eseguito commit `129c505`, push su GitHub e nuovo deploy di produzione su Vercel.

---

## 5. Riepilogo Risorse e Link Utili

- **URL Applicazione:** [https://casa-os-one.vercel.app/](https://casa-os-one.vercel.app/)
- **Repository GitHub:** [https://github.com/micdeangelis2-lang/casa](https://github.com/micdeangelis2-lang/casa)
- **Dashboard Progetto Vercel:** [https://vercel.com/micheles-projects-863019a6/casa-os](https://vercel.com/micheles-projects-863019a6/casa-os)
- **Database Neon (Console):** Frankfurt `fra1` (`eu-central-1`) collegato a Vercel
- **Cron Job:** `/api/cron/giornaliero` pianificato alle 05:00 UTC in `vercel.json`
