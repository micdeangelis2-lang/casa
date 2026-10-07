/**
 * Diagnosi dell'installazione: logica PURA. Riceve i dati raccolti da `scripts/doctor.ts` (che legge l'ambiente
 * reale) e restituisce esiti. Nei messaggi compaiono solo i NOMI delle variabili, mai i loro valori.
 */
import { createPublicKey } from "node:crypto";
import { getAuthEnv, getBackupEnv, getMailEnv, getServerEnv } from "../config/env";

export type DoctorLevel = "ok" | "avviso" | "errore";

export type DoctorOutcome = {
  id: string;
  level: DoctorLevel;
  /** Una frase in italiano. */
  message: string;
  /** Cosa fare, solo se serve. */
  remedy?: string;
};

export type JournalEntry = { tag: string; when: number };

export type AuditSnapshot =
  | { intact: true; rows: number; headSeq: number | null; headHash: string | null }
  | { intact: false; firstBrokenSeq: number };

export type FolderProbe = { dir: string; writable: boolean };

/** Dati raccolti. `null` = non raccolto (di solito perche' il database non risponde). */
export type DoctorInput = {
  env: Record<string, string | undefined>;
  /** `NODE_ENV=production`, `VERCEL_ENV=production` o `--prod`. */
  production: boolean;
  now: Date;
  database: { connected: true; latencyMs: number } | { connected: false } | null;
  /** `appliedMillis`: i `created_at` della tabella delle migrazioni di Drizzle (null = tabella assente). */
  migrations: { journal: JournalEntry[]; appliedMillis: number[] | null } | null;
  ownerCount: number | null;
  storage: FolderProbe | null;
  backupDir: FolderProbe | null;
  /** Fine dell'ultimo backup riuscito (completato o con avviso); `undefined` = nessuno; `null` = non raccolto. */
  lastBackupAt: Date | null | undefined;
  audit: AuditSnapshot | null;
};

const DAY_MS = 86_400_000;
export const BACKUP_MAX_AGE_DAYS = 7;
export const LATENCY_WARN_MS = 500;

const ok = (id: string, message: string): DoctorOutcome => ({ id, level: "ok", message });
const warn = (id: string, message: string, remedy?: string): DoctorOutcome => ({ id, level: "avviso", message, ...(remedy ? { remedy } : {}) });
const fail = (id: string, message: string, remedy?: string): DoctorOutcome => ({ id, level: "errore", message, ...(remedy ? { remedy } : {}) });
const skipped = (id: string, what: string): DoctorOutcome => warn(id, `${what}: non verificabile.`, "Risolvi prima il problema del database.");

const present = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** Esegue il getter di config su `source` e restituisce il messaggio d'errore (solo nomi) o null. */
function configError(parse: (source: NodeJS.ProcessEnv) => unknown, source: Record<string, string | undefined>): string | null {
  try {
    parse(source as NodeJS.ProcessEnv);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.replace(/^Configurazione ambiente non valida: /, "") : "configurazione non valida";
  }
}

export function checkRequiredEnv(env: DoctorInput["env"]): DoctorOutcome[] {
  const groups: { id: string; label: string; names: string; parse: (s: NodeJS.ProcessEnv) => unknown }[] = [
    { id: "env.database", label: "Database", names: "DATABASE_URL", parse: getServerEnv },
    { id: "env.auth", label: "Accesso", names: "BETTER_AUTH_SECRET, BETTER_AUTH_URL", parse: getAuthEnv },
  ];
  const out: DoctorOutcome[] = [];
  for (const g of groups) {
    const error = configError(g.parse, env);
    out.push(
      error
        ? fail(g.id, `Variabili non valide o mancanti (${g.label}): ${error}.`, "Correggile in .env.local (o nelle Environment Variables di Vercel): vedi .env.example.")
        : ok(g.id, `Variabili obbligatorie valide (${g.names}).`),
    );
  }
  const backupError = configError(getBackupEnv, env);
  out.push(
    backupError
      ? fail("env.backup", `Variabili non valide (backup e cron): ${backupError}.`, "Correggile: vedi .env.example.")
      : ok("env.backup", "Variabili dei backup (BACKUP_DIR, BACKUP_KEEP) valide."),
  );
  return out;
}

export function checkAuthUrl(env: DoctorInput["env"], production: boolean): DoctorOutcome {
  const raw = env.BETTER_AUTH_URL;
  if (!present(raw)) return fail("auth.url", "BETTER_AUTH_URL manca.", "Imposta l'origine pubblica dell'app, senza percorso né slash finale.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("auth.url", "BETTER_AUTH_URL non è un URL valido.", "Deve essere solo un'origine, per esempio https://tuo-dominio.it");
  }
  if (url.origin !== raw) return fail("auth.url", "BETTER_AUTH_URL deve essere solo l'origine (niente percorso, query o slash finale).", "Scrivila come https://tuo-dominio.it");
  if (production && url.protocol !== "https:") return fail("auth.url", "BETTER_AUTH_URL non usa https in produzione.", "Le passkey e i cookie sicuri richiedono https: imposta l'origine https:// del dominio.");
  if (url.protocol !== "https:") return ok("auth.url", "BETTER_AUTH_URL è un'origine valida (http ammesso solo fuori dalla produzione).");
  return ok("auth.url", "BETTER_AUTH_URL è un'origine https valida.");
}

export function checkDatabase(database: DoctorInput["database"]): DoctorOutcome {
  if (database === null) return skipped("db.connection", "Connessione al database");
  if (!database.connected) return fail("db.connection", "Il database non risponde.", "Controlla che sia acceso (in locale: pnpm dev:db) e che DATABASE_URL sia giusta.");
  if (database.latencyMs > LATENCY_WARN_MS) return warn("db.connection", `Database raggiunto ma lento: ${database.latencyMs} ms.`, "Controlla la regione del database e la stringa «pooled».");
  return ok("db.connection", `Database raggiunto in ${database.latencyMs} ms.`);
}

export function checkMigrations(data: DoctorInput["migrations"]): DoctorOutcome {
  if (data === null) return skipped("db.migrations", "Migrazioni");
  const { journal, appliedMillis } = data;
  if (appliedMillis === null) {
    return fail("db.migrations", `Nessuna migrazione applicata (ce ne sono ${journal.length} in drizzle/).`, "Esegui pnpm db:migrate.");
  }
  const applied = new Set(appliedMillis);
  const known = new Set(journal.map((e) => e.when));
  const missing = journal.filter((e) => !applied.has(e.when));
  const extra = appliedMillis.filter((m) => !known.has(m));
  if (extra.length > 0) {
    return fail(
      "db.migrations",
      `Il database ha ${extra.length} migrazion${extra.length === 1 ? "e" : "i"} che questo codice non conosce.`,
      "Probabile codice più vecchio del database: pubblica la versione giusta, oppure verifica di non puntare un altro database.",
    );
  }
  if (missing.length > 0) {
    const tags = missing.map((e) => e.tag).join(", ");
    return fail("db.migrations", `Mancano ${missing.length} migrazion${missing.length === 1 ? "e" : "i"}: ${tags}.`, "Fai un backup, poi pnpm db:migrate.");
  }
  return ok("db.migrations", `Migrazioni allineate: ${journal.length} applicate, nessuna in più.`);
}

export function checkOwner(ownerCount: number | null, env: DoctorInput["env"]): DoctorOutcome[] {
  if (ownerCount === null) return [skipped("owner.exists", "Account del proprietario")];
  const tokenSet = present(env.OWNER_BOOTSTRAP_TOKEN);
  if (ownerCount === 0) {
    return [
      fail(
        "owner.exists",
        "Il proprietario non esiste ancora: la configurazione iniziale non è stata fatta.",
        tokenSet ? "Apri /configurazione-iniziale e crea l'account." : "Imposta OWNER_BOOTSTRAP_TOKEN (almeno 32 caratteri), riavvia e apri /configurazione-iniziale.",
      ),
    ];
  }
  const out: DoctorOutcome[] = [
    ownerCount === 1 ? ok("owner.exists", "Il proprietario esiste.") : fail("owner.exists", `Ci sono ${ownerCount} utenti: l'app ne prevede uno solo.`, "Verifica la tabella degli utenti prima di proseguire."),
  ];
  out.push(
    tokenSet
      ? warn("owner.token", "OWNER_BOOTSTRAP_TOKEN è ancora impostato dopo la configurazione.", "Rimuovilo dall'ambiente: serve solo per creare l'account (vedi il manuale, §6).")
      : ok("owner.token", "OWNER_BOOTSTRAP_TOKEN non è impostato."),
  );
  return out;
}

export function checkFolder(id: string, label: string, probe: FolderProbe | null): DoctorOutcome {
  if (probe === null) return warn(id, `${label}: non verificata.`);
  return probe.writable
    ? ok(id, `${label}: la cartella «${probe.dir}» è scrivibile.`)
    : fail(id, `${label}: la cartella «${probe.dir}» non è scrivibile.`, "Controlla i permessi e che il disco non sia a sola lettura (su Vercel serve un adattatore per i file online).");
}

export function checkBackupKey(env: DoctorInput["env"]): DoctorOutcome {
  const raw = env.BACKUP_PUBLIC_KEY;
  if (!present(raw)) return warn("backup.key", "BACKUP_PUBLIC_KEY non è impostata: i backup non possono partire.", "Genera la coppia con pnpm backup:keygen e imposta la chiave PUBBLICA.");
  const pem = raw.replace(/\\n/g, "\n").trim();
  if (/PRIVATE KEY/.test(pem)) {
    return fail("backup.key", "BACKUP_PUBLIC_KEY contiene una chiave PRIVATA.", "Toglila subito dall'ambiente: la privata resta solo a te, fuori dal server. Imposta la pubblica e valuta di rigenerare la coppia.");
  }
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "rsa") return fail("backup.key", "BACKUP_PUBLIC_KEY non è una chiave RSA.", "Rigenera la coppia con pnpm backup:keygen.");
  } catch {
    return fail("backup.key", "BACKUP_PUBLIC_KEY non è una chiave pubblica PEM valida.", "Scrivila su una riga con i ritorni a capo come backslash-n (vedi .env.example).");
  }
  return ok("backup.key", "BACKUP_PUBLIC_KEY è una chiave pubblica PEM valida.");
}

/**
 * F-06: senza il segreto di firma i backup non sono autenticati (chi conosce la chiave pubblica puo' fabbricarne uno).
 * Avviso solo se i backup sono configurati (c'e' la chiave pubblica); un segreto troppo corto lo segnala `env.backup`.
 */
export function checkBackupSigning(env: DoctorInput["env"]): DoctorOutcome {
  if (!present(env.BACKUP_PUBLIC_KEY)) return ok("backup.signing", "Firma dei backup: non necessaria, i backup non sono configurati.");
  if (present(env.BACKUP_SIGNING_SECRET)) return ok("backup.signing", "I backup sono firmati (BACKUP_SIGNING_SECRET impostato).");
  return warn(
    "backup.signing",
    "BACKUP_SIGNING_SECRET non è impostato: i backup non sono firmati e il ripristino non può distinguerli da uno fabbricato.",
    "Genera un segreto (openssl rand -base64 32), impostalo e custodiscine una copia fuori dal server: serve per ripristinare.",
  );
}

export function checkLastBackup(lastBackupAt: DoctorInput["lastBackupAt"], now: Date): DoctorOutcome {
  if (lastBackupAt === null) return skipped("backup.age", "Età dell'ultimo backup");
  if (lastBackupAt === undefined) return warn("backup.age", "Nessun backup riuscito finora.", "Fai un backup (pnpm backup:run o Impostazioni, Backup).");
  const days = Math.floor((now.getTime() - lastBackupAt.getTime()) / DAY_MS);
  if (days > BACKUP_MAX_AGE_DAYS) return warn("backup.age", `L'ultimo backup riuscito risale a ${days} giorni fa.`, "Fai un backup e controlla perché il giro giornaliero non lo ha fatto.");
  return ok("backup.age", days <= 0 ? "L'ultimo backup riuscito è di oggi." : `L'ultimo backup riuscito risale a ${days} giorn${days === 1 ? "o" : "i"} fa.`);
}

export function checkAudit(audit: DoctorInput["audit"]): DoctorOutcome {
  if (audit === null) return skipped("audit.chain", "Registro delle modifiche");
  if (!audit.intact) {
    return fail("audit.chain", `Il registro delle modifiche ha un'anomalia alla riga n. ${audit.firstBrokenSeq}.`, "Non scrivere nulla nel database: fai una copia e confrontala con un backup (manuale, §7).");
  }
  const head = audit.headSeq !== null && audit.headHash ? ` Testa: riga ${audit.headSeq}, impronta ${audit.headHash.slice(0, 16)}…` : "";
  return ok("audit.chain", `Registro delle modifiche integro: ${audit.rows} righe.${head}`);
}

export function checkCronSecret(env: DoctorInput["env"], production: boolean): DoctorOutcome {
  const value = env.CRON_SECRET;
  if (!present(value)) {
    const remedy = "Impostalo (almeno 16 caratteri) nel progetto Vercel: senza, le route /api/cron/* rispondono 401 e il giro giornaliero non parte.";
    return production ? fail("cron.secret", "CRON_SECRET non è impostato.", remedy) : warn("cron.secret", "CRON_SECRET non è impostato.", remedy);
  }
  return value.length >= 16 ? ok("cron.secret", "CRON_SECRET è impostato.") : fail("cron.secret", "CRON_SECRET è troppo corto (minimo 16 caratteri).", "Generane uno nuovo, per esempio con openssl rand -base64 32.");
}

export function checkMail(env: DoctorInput["env"]): DoctorOutcome {
  const error = configError(getMailEnv, env);
  if (error) return warn("mail.config", `Email non configurata correttamente: ${error}.`, "Informativo: gli avvisi restano comunque nell'app.");
  const key = present(env.RESEND_API_KEY);
  const from = present(env.MAIL_FROM);
  if (key && from) return ok("mail.config", "Email (Resend) configurata: non è stato inviato nulla per provarla.");
  if (key !== from) return warn("mail.config", `Email a metà: manca ${key ? "MAIL_FROM" : "RESEND_API_KEY"}.`, "Informativo: senza entrambe non partono email, gli avvisi restano nell'app.");
  return warn("mail.config", "Email non configurata (RESEND_API_KEY, MAIL_FROM).", "Informativo: gli avvisi restano nell'app, non partono email.");
}

/**
 * F-02 della revisione di sicurezza: il limite di frequenza dell'accesso usa l'intestazione `x-real-ip` cosi' com'e'. Non e'
 * verificabile da qui (serve il deploy reale): in produzione resta un avviso informativo con la prova da fare a mano.
 */
export function checkClientIpTrust(production: boolean): DoctorOutcome {
  if (!production) return ok("auth.client_ip", "Indirizzo del client per il limite di frequenza: controllo previsto solo in produzione.");
  // Livello «ok» con promemoria: non e' un guasto e non e' verificabile da qui, quindi non deve sporcare un'installazione sana.
  return {
    ...ok("auth.client_ip", "Il limite di frequenza dell'accesso si fida di x-real-ip (da verificare a mano dopo il deploy)."),
    remedy: "Va bene solo se il proxy (su Vercel, la piattaforma) lo sovrascrive. Prova curl -H \"x-real-ip: 1.2.3.4\" e controlla che l'indirizzo registrato nell'audit sia il tuo, non quello inviato.",
  };
}

/** Tutti i controlli, nell'ordine in cui compaiono nel rapporto. */
export function runChecks(input: DoctorInput): DoctorOutcome[] {
  return [
    ...checkRequiredEnv(input.env),
    checkAuthUrl(input.env, input.production),
    checkDatabase(input.database),
    checkMigrations(input.migrations),
    ...checkOwner(input.ownerCount, input.env),
    checkFolder("storage.writable", "Cartella dei documenti", input.storage),
    checkFolder("backup.writable", "Cartella dei backup", input.backupDir),
    checkBackupKey(input.env),
    checkBackupSigning(input.env),
    checkLastBackup(input.lastBackupAt, input.now),
    checkAudit(input.audit),
    checkCronSecret(input.env, input.production),
    checkMail(input.env),
    checkClientIpTrust(input.production),
  ];
}

const SYMBOL: Record<DoctorLevel, string> = { ok: "✔", avviso: "⚠", errore: "✖" };

export function formatReport(outcomes: DoctorOutcome[]): { text: string; exitCode: 0 | 1 } {
  const lines: string[] = [];
  for (const o of outcomes) {
    lines.push(`${SYMBOL[o.level]} ${o.message}`);
    if (o.remedy) lines.push(`    → ${o.remedy}`);
  }
  const count = (l: DoctorLevel) => outcomes.filter((o) => o.level === l).length;
  const errors = count("errore");
  lines.push("", `Riepilogo: ${count("ok")} ok, ${count("avviso")} avvisi, ${errors} errori.`);
  return { text: lines.join("\n"), exitCode: errors > 0 ? 1 : 0 };
}
