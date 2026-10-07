import { z } from "zod";

/**
 * Variabili d'ambiente validate al primo uso (mai a livello di modulo:
 * `next build` valuta i moduli prima che l'ambiente sia configurato).
 * Negli errori compaiono solo i NOMI delle variabili, mai i valori (potrebbero essere segreti).
 */

const serverEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL e' obbligatoria")
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "DATABASE_URL deve essere un URL postgres://",
    }),
  /** Connessioni massime del pool. I test e2e con PGlite usano 1. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
});

const authEnvSchema = z.object({
  /** Genera con `openssl rand -base64 32`. */
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET deve avere almeno 32 caratteri"),
  /** Origine pubblica dell'app (senza slash finale). Da qui derivano origin e rpID delle passkey. */
  BETTER_AUTH_URL: z
    .url()
    .refine((v) => new URL(v).origin === v, { message: "BETTER_AUTH_URL deve essere solo l'origine, senza percorso" }),
  /**
   * Token monouso per creare l'account del proprietario. Serve solo finche' non esiste un utente:
   * dopo il primo accesso va rimosso dall'ambiente.
   */
  OWNER_BOOTSTRAP_TOKEN: z.string().min(32, "OWNER_BOOTSTRAP_TOKEN deve avere almeno 32 caratteri").optional(),
});

const backupEnvSchema = z.object({
  /**
   * Chiave PUBBLICA (PEM) con cui si cifrano i backup. La chiave privata non sta mai sul server:
   * si genera con `pnpm backup:keygen` e la custodisce il proprietario. Senza chiave i backup non partono.
   */
  BACKUP_PUBLIC_KEY: z
    .string()
    .optional()
    .transform((v) => v?.replace(/\\n/g, "\n").trim() || undefined),
  /** Cartella di destinazione dei backup (adattatore su disco). Con un secondo fornitore cambiera' l'adattatore. */
  BACKUP_DIR: z.string().default("backups"),
  /** Quanti backup tenere nella destinazione. */
  BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(14),
  /** Segreto del cron di Vercel (header Authorization: Bearer ...). Senza, la route del cron e' chiusa. */
  CRON_SECRET: z.string().min(16, "CRON_SECRET deve avere almeno 16 caratteri").optional(),
});

const mailEnvSchema = z.object({
  /** Servizio email per gli avvisi (Resend). Senza, gli avvisi restano solo nell'app. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** Mittente, es. "Gestione Immobili <avvisi@tuo-dominio.it>" (dominio verificato presso il servizio). */
  MAIL_FROM: z.string().min(3).optional(),
});


function parseEnv<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join("; ");
    throw new Error(`Configurazione ambiente non valida: ${names}`);
  }
  return parsed.data;
}

function memoized<T>(parse: (source: NodeJS.ProcessEnv) => T): (source?: NodeJS.ProcessEnv) => T {
  let cached: T | null = null;
  return (source = process.env) => {
    if (source !== process.env) return parse(source);
    return (cached ??= parse(source));
  };
}

export const getServerEnv = memoized((s) => parseEnv(serverEnvSchema, s));
export const getAuthEnv = memoized((s) => parseEnv(authEnvSchema, s));
export const getMailEnv = memoized((s) => parseEnv(mailEnvSchema, s));
export const getBackupEnv = memoized((s) => parseEnv(backupEnvSchema, s));
