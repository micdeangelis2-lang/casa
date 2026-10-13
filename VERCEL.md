# Far funzionare Gestione Immobili su vercel.app

Guida pratica: cosa serve, in che ordine, come si controlla che funzioni e cosa fare se qualcosa non va. Stato aggiornato al 2026-10-13. L'app online è https://casa-os-one.vercel.app/ (progetto Vercel `casa-os`).

Non scrivere mai nel repository i valori dei segreti: qui compaiono solo i **nomi** delle variabili.

---

## 1. Stato in breve

| Voce | Stato |
|---|---|
| Progetto Vercel `casa-os` (Root Directory `app`, framework Next.js) | Fatto |
| Variabili di autenticazione e cron | Fatto |
| Database Neon (Francoforte) + 28 migrazioni + Comuni ISTAT | Fatto |
| Passkey facoltativa (basta il TOTP) | Fatto (`DECISIONS.md` E91) |
| File dei documenti su Vercel Blob privato (`casa-files`) | Store creato; **serve il deploy del codice nuovo** (vedi §6) |
| Backup su destinazione remota e cron del backup | **Da fare** |
| Rimozione di `OWNER_BOOTSTRAP_TOKEN` dopo la configurazione | **Da fare** |
| Email degli avvisi (Resend) | Facoltativa, non configurata |

---

## 2. Cosa serve (una volta sola)

1. **Account**: Vercel (piano Hobby, gratuito, solo uso personale e non commerciale) e il database Neon collegato dal Marketplace di Vercel. Il repository GitHub è `micdeangelis2-lang/casa`.
2. **Progetto Vercel**: l'app sta nella cartella `app/`, quindi vanno impostati **Root Directory = `app`** e **Framework = Next.js** (senza, il sito risponde `404 NOT_FOUND`):
   ```bash
   npx vercel project update casa-os --root-directory app --framework nextjs --yes
   ```
3. **Node**: il progetto richiede Node 24.x (`app/package.json`, `engines`). Vercel lo legge da lì.
4. **Cron**: `app/vercel.json` pianifica `/api/cron/giornaliero` alle 05:00 UTC. Sul piano Hobby un cron può girare una sola volta al giorno: va bene.

---

## 3. Variabili d'ambiente

Si impostano in Vercel (Settings → Environment Variables) o con `npx vercel env add NOME production,preview --value "…" --yes`. Per controllare cosa manca usa la pagina **Impostazioni → Stato dell'installazione** (mostra solo i nomi).

| Variabile | Obbligatoria | Note |
|---|---|---|
| `DATABASE_URL` | Sì | Stringa **pooled** di Neon. La imposta l'integrazione Neon di Vercel. |
| `DATABASE_URL_UNPOOLED` | Per le migrazioni | Connessione diretta, impostata dall'integrazione. |
| `BETTER_AUTH_SECRET` | Sì | Almeno 32 caratteri casuali (`openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | Sì | Esattamente l'indirizzo pubblico, es. `https://casa-os-one.vercel.app`. Serve all'origine WebAuthn e ai cookie: se il dominio cambia, va cambiata anche questa. |
| `OWNER_BOOTSTRAP_TOKEN` | Solo all'inizio | Serve a creare l'account in `/configurazione-iniziale`. **Rimuoverla subito dopo** (vedi §7). |
| `CRON_SECRET` | Sì per il cron | Almeno 16 caratteri. Senza, `/api/cron/*` risponde 401 e il giro giornaliero non parte. |
| `BLOB_READ_WRITE_TOKEN` | Sì per i documenti | La imposta Vercel quando si collega lo store Blob (§5). Senza, l'app prova a scrivere sul disco, che online non persiste. |
| `BACKUP_PUBLIC_KEY` | Per i backup | Chiave **pubblica** generata con `pnpm backup:keygen`. La chiave privata resta solo a te, fuori da Vercel. |
| `BACKUP_SIGNING_SECRET` | Consigliata | Almeno 32 caratteri; firma i backup. |
| `RESEND_API_KEY`, `MAIL_FROM` | Facoltative | Email degli avvisi. Senza, gli avvisi restano solo nell'app. |
| `DATABASE_POOL_MAX` | No | Predefinito 5. Su Vercel si può abbassare a 2–3. |

Non impostare `STORAGE_DIR` e `BACKUP_DIR` su Vercel: sono cartelle locali.

---

## 4. Database

1. Collega Neon dal Marketplace (regione Francoforte):
   ```bash
   npx vercel integration add neon --name casa-db -m region=fra1 --plan free_v3
   ```
2. Applica le migrazioni **dal tuo computer**, con le variabili di Vercel scaricate in locale, **prima** di pubblicare codice che le richiede (sono additive):
   ```bash
   pnpm db:migrate
   ```
3. Carica i Comuni italiani (idempotente, si può rilanciare):
   ```bash
   pnpm territory:import
   ```
4. Opzionale: tipi di tributo predefiniti dalla pagina Tributi → Tipi → «Carica i tipi».

Attenzione: se il tuo `.env.local` locale contiene la `DATABASE_URL` di Neon, **`pnpm dev` e gli script scrivono nel database di produzione**. Per provare in locale in sicurezza usa il database locale (`pnpm dev:db`, `app/.pglite`) con un `.env.local` che punti a `127.0.0.1:54320`.

---

## 5. File dei documenti: Vercel Blob privato

Il disco di Vercel non persiste, quindi i documenti vanno su uno store Blob **privato**.

```bash
npx vercel blob create-store casa-files --access private --region fra1 -e production -e preview --yes
```

Il comando collega lo store al progetto e Vercel imposta `BLOB_READ_WRITE_TOKEN`. (Lo store `casa-files` esiste già.)

Con il token presente l'app usa Blob; i file di oltre circa 4,5 MB (limite delle richieste su Vercel) vengono caricati **direttamente dal browser** verso Blob in `staging/<uuid>` e poi registrati dall'app. Dettagli e limiti: `DECISIONS.md` E92.

Limiti del piano gratuito: circa 1 GB di spazio e 10 GB di trasferimento al mese (le fonti non coincidono: controlla la pagina Usage del progetto).

---

## 6. Pubblicare il codice (deploy)

Il collegamento con GitHub **non** fa partire il deploy da solo: dopo ogni push a `main` il deploy di produzione si lancia a mano, dalla radice del repository:

```bash
git push origin main
npx vercel deploy --prod --yes
```

Il deploy esegue la build di Next.js su Vercel (circa 1–2 minuti). Ordine consigliato quando una modifica richiede una migrazione: `pnpm db:migrate` → push → deploy.

---

## 7. Prima configurazione dell'account

1. Apri `https://casa-os-one.vercel.app/configurazione-iniziale` e inserisci il token (`OWNER_BOOTSTRAP_TOKEN`) per creare il proprietario.
2. Imposta la password e attiva l'app di autenticazione (TOTP). La passkey è facoltativa ma consigliata.
3. **Rimuovi `OWNER_BOOTSTRAP_TOKEN`** da tutti gli ambienti Vercel (e dal tuo `.env.local`):
   ```bash
   npx vercel env rm OWNER_BOOTSTRAP_TOKEN production --yes
   ```
   Poi rifai il deploy: la variabile resta nell'ultima build finché non si ripubblica.
4. Genera la coppia di chiavi dei backup con `pnpm backup:keygen`, imposta la riga `BACKUP_PUBLIC_KEY` su Vercel e conserva la chiave privata **fuori dal computer e fuori da Vercel**.

---

## 8. Come verificare che funzioni

1. `https://casa-os-one.vercel.app/api/health` risponde `{"status":"ok"}` (200).
2. Le pagine protette rimandano a `/accesso` senza sessione.
3. Dopo l'accesso, **Impostazioni → Stato dell'installazione** non deve mostrare errori. Avvisi attesi finché mancano: chiave dei backup, email.
4. **Documenti → Carica** con un PDF da circa 10 MB: deve comparire «Invio del file in corso» e poi la scheda del documento; il file si apre dalla scheda e si trova nella ricerca.
5. Prova «nuova versione» e «carica più documenti» con 2–3 file, uno duplicato.
6. Il giorno dopo, nel registro (Impostazioni → Registro) deve comparire la riga `deadline.cycle` del cron.

---

## 9. Se qualcosa non va

| Sintomo | Causa probabile | Rimedio |
|---|---|---|
| `404 NOT_FOUND` su tutto il sito | Root Directory non impostata | `vercel project update … --root-directory app --framework nextjs` |
| Errore 500, log «Configurazione ambiente non valida» | Variabile mancante (`BETTER_AUTH_*`, `DATABASE_URL`) | Imposta la variabile (§3) e rifai il deploy; leggi i log con `npx vercel logs` |
| «Il login con passkey non funziona» | `BETTER_AUTH_URL` diverso dall'indirizzo del sito | Allinea la variabile al dominio reale e rifai il deploy |
| Il caricamento di un documento fallisce | Manca `BLOB_READ_WRITE_TOKEN` o il codice nuovo non è stato pubblicato | §5 e §6 |
| Il caricamento fallisce solo oltre ~4 MB | È in esecuzione la versione senza caricamento diretto | Fai il deploy del codice aggiornato |
| Il primo accesso dopo una pausa è lento | Neon si addormenta dopo 5 minuti senza uso | Normale sul piano gratuito |
| Il cron non parte | `CRON_SECRET` mancante, o piano che non permette la frequenza | Imposta il segreto; su Hobby solo una volta al giorno |
| I comandi `pnpm doctor` non stampano nulla | `doctor` è anche un comando interno di pnpm | Usa `pnpm run doctor` |

---

## 10. Cosa non è ancora a posto

- **Backup online**: il backup scrive su disco e non esiste una destinazione remota; il cron del backup non è schedulato. Finché manca, la sola rete di sicurezza è il ripristino a un istante del tempo di Neon (nel piano gratuito copre solo le ultime ore). Non caricare documenti importanti senza un backup che hai provato a ripristinare.
- **File di staging abbandonati**: se chiudi la pagina a metà di un caricamento diretto, `staging/<uuid>` resta nello store finché non lo cancelli (manca una pulizia periodica).
- **Durata massima** delle funzioni non impostata per le operazioni lunghe (esportazione, pacchetti di condivisione).
- **Limite dei tentativi di accesso**: non è verificato dove viva (in memoria non varrebbe su più istanze).
- **Email degli avvisi** non configurate.
- Il flusso di caricamento diretto dal browser non è stato provato end-to-end su Vercel (richiede la sessione del proprietario): usa la verifica del §8.
