import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkAudit,
  checkAuthUrl,
  checkBackupKey,
  checkBackupSigning,
  checkClientIpTrust,
  checkCronSecret,
  checkDatabase,
  checkFolder,
  checkLastBackup,
  checkMail,
  checkMigrations,
  checkOwner,
  checkRequiredEnv,
} from "@/platform/doctor/checks";

const NOW = new Date("2026-10-06T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("diagnosi: casi limite dei singoli controlli", () => {
  it("BETTER_AUTH_URL: mancante, non un URL, con percorso o slash finale, http in produzione e fuori", () => {
    expect(checkAuthUrl({}, true).level).toBe("errore");
    expect(checkAuthUrl({ BETTER_AUTH_URL: "   " }, true).message).toContain("manca");
    expect(checkAuthUrl({ BETTER_AUTH_URL: "non un url" }, false).message).toContain("non è un URL valido");
    expect(checkAuthUrl({ BETTER_AUTH_URL: "https://casa.example.it/" }, true).level).toBe("errore");
    expect(checkAuthUrl({ BETTER_AUTH_URL: "https://casa.example.it/app" }, true).level).toBe("errore");
    expect(checkAuthUrl({ BETTER_AUTH_URL: "http://casa.example.it" }, true).level).toBe("errore");
    expect(checkAuthUrl({ BETTER_AUTH_URL: "http://localhost:3000" }, false).level).toBe("ok");
    expect(checkAuthUrl({ BETTER_AUTH_URL: "https://casa.example.it" }, true)).toMatchObject({ level: "ok" });
  });

  it("database: non raccolto, spento, lento (500 ms ancora ok, 501 avviso)", () => {
    expect(checkDatabase(null).level).toBe("avviso");
    expect(checkDatabase({ connected: false }).level).toBe("errore");
    expect(checkDatabase({ connected: true, latencyMs: 500 }).level).toBe("ok");
    expect(checkDatabase({ connected: true, latencyMs: 501 }).level).toBe("avviso");
  });

  it("migrazioni: non raccolte, tabella assente, in piu', mancanti (singolare e plurale), allineate", () => {
    const journal = [{ tag: "0000_a", when: 1 }, { tag: "0001_b", when: 2 }, { tag: "0002_c", when: 3 }];
    expect(checkMigrations(null).level).toBe("avviso");
    expect(checkMigrations({ journal, appliedMillis: null }).message).toContain("Nessuna migrazione applicata");
    expect(checkMigrations({ journal, appliedMillis: [1, 2, 3, 99] }).message).toContain("1 migrazione che questo codice non conosce");
    expect(checkMigrations({ journal, appliedMillis: [1, 2, 3, 98, 99] }).message).toContain("2 migrazioni che questo codice non conosce");
    expect(checkMigrations({ journal, appliedMillis: [1, 2] }).message).toBe("Mancano 1 migrazione: 0002_c.");
    expect(checkMigrations({ journal, appliedMillis: [1] }).message).toBe("Mancano 2 migrazioni: 0001_b, 0002_c.");
    expect(checkMigrations({ journal, appliedMillis: [3, 2, 1] }).level).toBe("ok");
    expect(checkMigrations({ journal: [], appliedMillis: [] }).level).toBe("ok");
  });

  it("proprietario: non raccolto; nessuno (con e senza token); piu' di uno; token rimasto", () => {
    expect(checkOwner(null, {})).toHaveLength(1);
    expect(checkOwner(0, {})[0]!.remedy).toContain("Imposta OWNER_BOOTSTRAP_TOKEN");
    expect(checkOwner(0, { OWNER_BOOTSTRAP_TOKEN: "x".repeat(32) })[0]!.remedy).toContain("/configurazione-iniziale");
    const many = checkOwner(2, {});
    expect(many[0]).toMatchObject({ level: "errore" });
    expect(many[0]!.message).toContain("2 utenti");
    expect(checkOwner(1, { OWNER_BOOTSTRAP_TOKEN: "  " }).map((o) => o.level)).toEqual(["ok", "ok"]);
    const left = checkOwner(1, { OWNER_BOOTSTRAP_TOKEN: "x".repeat(32) });
    expect(left[1]).toMatchObject({ id: "owner.token", level: "avviso" });
    expect(left[1]!.message).not.toContain("xxxx");
  });

  it("cartelle: non verificata, non scrivibile, scrivibile", () => {
    expect(checkFolder("a", "Cartella", null).level).toBe("avviso");
    expect(checkFolder("a", "Cartella", { dir: "d", writable: false }).level).toBe("errore");
    expect(checkFolder("a", "Cartella", { dir: "d", writable: true }).level).toBe("ok");
  });

  it("chiave di backup: assente, privata (anche con ritorni a capo scritti), non RSA, spazzatura, valida", () => {
    expect(checkBackupKey({}).level).toBe("avviso");
    expect(checkBackupKey({ BACKUP_PUBLIC_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----" }).message).toContain("PRIVATA");
    const ed = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(checkBackupKey({ BACKUP_PUBLIC_KEY: ed }).message).toContain("non è una chiave RSA");
    expect(checkBackupKey({ BACKUP_PUBLIC_KEY: "non una chiave" }).message).toContain("non è una chiave pubblica PEM valida");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(checkBackupKey({ BACKUP_PUBLIC_KEY: rsa.trim().split("\n").join("\\n") }).level).toBe("ok");
  });

  it("firma dei backup: non necessaria senza chiave pubblica, avviso se manca il segreto, ok se c'e'", () => {
    expect(checkBackupSigning({}).level).toBe("ok");
    expect(checkBackupSigning({ BACKUP_PUBLIC_KEY: "k" }).level).toBe("avviso");
    expect(checkBackupSigning({ BACKUP_PUBLIC_KEY: "k", BACKUP_SIGNING_SECRET: " " }).level).toBe("avviso");
    expect(checkBackupSigning({ BACKUP_PUBLIC_KEY: "k", BACKUP_SIGNING_SECRET: "s" }).level).toBe("ok");
  });

  it("ultimo backup: non raccolto, mai fatto, oggi, ieri, sette giorni (ok) e otto (avviso)", () => {
    expect(checkLastBackup(null, NOW).level).toBe("avviso");
    expect(checkLastBackup(undefined, NOW).message).toContain("Nessun backup");
    expect(checkLastBackup(day(0), NOW).message).toContain("di oggi");
    expect(checkLastBackup(new Date(NOW.getTime() + 3_600_000), NOW).message).toContain("di oggi");
    expect(checkLastBackup(day(1), NOW).message).toContain("1 giorno fa");
    expect(checkLastBackup(day(3), NOW).message).toContain("3 giorni fa");
    expect(checkLastBackup(day(7), NOW).level).toBe("ok");
    expect(checkLastBackup(day(8), NOW)).toMatchObject({ level: "avviso" });
  });

  it("registro: non raccolto, interrotto (con il numero di riga), integro senza testa, integro con testa abbreviata", () => {
    expect(checkAudit(null).level).toBe("avviso");
    expect(checkAudit({ intact: false, firstBrokenSeq: 7 })).toMatchObject({ level: "errore" });
    expect(checkAudit({ intact: false, firstBrokenSeq: 7 }).message).toContain("n. 7");
    expect(checkAudit({ intact: true, rows: 0, headSeq: null, headHash: null }).message).toBe("Registro delle modifiche integro: 0 righe.");
    expect(checkAudit({ intact: true, rows: 3, headSeq: 3, headHash: "0123456789abcdef0123" }).message).toContain("impronta 0123456789abcdef…");
    expect(checkAudit({ intact: true, rows: 3, headSeq: 3, headHash: "" }).message).not.toContain("Testa");
  });

  it("segreto del cron: assente (errore in produzione, avviso fuori), corto, lungo il minimo", () => {
    expect(checkCronSecret({}, true).level).toBe("errore");
    expect(checkCronSecret({}, false).level).toBe("avviso");
    expect(checkCronSecret({ CRON_SECRET: "   " }, true).level).toBe("errore");
    expect(checkCronSecret({ CRON_SECRET: "a".repeat(15) }, false).level).toBe("errore");
    expect(checkCronSecret({ CRON_SECRET: "a".repeat(16) }, true).level).toBe("ok");
  });

  it("email: configurata, a meta' (nei due sensi), assente, valore non valido", () => {
    expect(checkMail({ RESEND_API_KEY: "k", MAIL_FROM: "Casa <a@example.it>" }).level).toBe("ok");
    expect(checkMail({ RESEND_API_KEY: "k" }).message).toContain("manca MAIL_FROM");
    expect(checkMail({ MAIL_FROM: "Casa <a@example.it>" }).message).toContain("manca RESEND_API_KEY");
    expect(checkMail({}).message).toContain("non configurata");
    expect(checkMail({ MAIL_FROM: "ab" }).message).toContain("non configurata correttamente");
    expect(checkMail({ RESEND_API_KEY: "k", MAIL_FROM: "ab" }).level).toBe("avviso");
  });

  it("indirizzo del client: promemoria solo in produzione, mai un avviso", () => {
    expect(checkClientIpTrust(false).remedy).toBeUndefined();
    const prod = checkClientIpTrust(true);
    expect(prod.level).toBe("ok");
    expect(prod.remedy).toContain("x-real-ip");
  });

  it("variabili obbligatorie: nei messaggi solo i NOMI, mai i valori", () => {
    const out = checkRequiredEnv({ DATABASE_URL: "mysql://utente:segretissimo@h/db", BETTER_AUTH_SECRET: "corto-segretissimo", BETTER_AUTH_URL: "https://x.it/percorso", BACKUP_KEEP: "0" });
    expect(out.map((o) => o.level)).toEqual(["errore", "errore", "errore"]);
    expect(JSON.stringify(out)).not.toContain("segretissimo");
    expect(out[0]!.message).toContain("DATABASE_URL");
  });
});
