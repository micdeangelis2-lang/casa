import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateBackupKeyPair } from "@/shared/archive/crypto";
import { formatReport, runChecks, type DoctorInput, type DoctorOutcome } from "@/platform/doctor/checks";

const NOW = new Date("2026-10-06T12:00:00Z");
const SECRET = "s3cr3t-valore-che-non-deve-comparire-mai-0123456789";
const { publicKey, privateKey } = generateBackupKeyPair();
const oneLine = (pem: string) => pem.trim().split("\n").join("\\n");
const journal = [
  { tag: "0000_a", when: 1000 },
  { tag: "0001_b", when: 2000 },
];

const goodEnv = {
  DATABASE_URL: "postgres://utente:pwd-segreta@host/db",
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: "https://casa.example.it",
  BACKUP_PUBLIC_KEY: oneLine(publicKey),
  CRON_SECRET: "cron-secret-lungo-abbastanza",
  RESEND_API_KEY: "re_xxx",
  MAIL_FROM: "Casa <a@example.it>",
};

const good = (over: Partial<DoctorInput> = {}): DoctorInput => ({
  env: goodEnv,
  production: true,
  now: NOW,
  database: { connected: true, latencyMs: 12 },
  migrations: { journal, appliedMillis: [1000, 2000] },
  ownerCount: 1,
  storage: { dir: ".storage", writable: true },
  backupDir: { dir: "backups", writable: true },
  lastBackupAt: new Date("2026-10-05T05:00:00Z"),
  audit: { intact: true, rows: 42, headSeq: 42, headHash: "abcdef0123456789abcdef0123456789" },
  ...over,
});

const get = (outcomes: DoctorOutcome[], id: string) => outcomes.find((o) => o.id === id)!;
const levels = (input: DoctorInput) => Object.fromEntries(runChecks(input).map((o) => [o.id, o.level]));

describe("pnpm doctor: controlli", () => {
  it("un'installazione sana e' tutta ok e il codice di uscita e' 0", () => {
    const outcomes = runChecks(good());
    expect(outcomes.filter((o) => o.level !== "ok")).toEqual([]);
    const report = formatReport(outcomes);
    expect(report.exitCode).toBe(0);
    expect(report.text).toContain("✔");
    expect(report.text).toContain("riga 42, impronta abcdef0123456789");
  });

  it("variabili mancanti: errore, con i soli nomi", () => {
    const outcomes = runChecks(good({ env: { ...goodEnv, DATABASE_URL: "mysql://u:pwd-segreta@h/d", BETTER_AUTH_SECRET: "corto-SEGRETO" } }));
    expect(get(outcomes, "env.database").level).toBe("errore");
    expect(get(outcomes, "env.auth").level).toBe("errore");
    const text = formatReport(outcomes).text;
    expect(text).toContain("DATABASE_URL");
    expect(text).toContain("BETTER_AUTH_SECRET");
    expect(text).not.toMatch(/pwd-segreta|corto-SEGRETO|mysql:/);
    expect(formatReport(outcomes).exitCode).toBe(1);
  });

  it("nessun valore segreto compare mai nel rapporto", () => {
    const text = formatReport(runChecks(good({ env: { ...goodEnv, OWNER_BOOTSTRAP_TOKEN: "tok-" + "x".repeat(40) } }))).text;
    for (const secret of [SECRET, "pwd-segreta", "cron-secret-lungo", "re_xxx", "tok-xxxx", publicKey.split("\n")[1]!]) expect(text).not.toContain(secret);
  });

  it("BETTER_AUTH_URL: origine, https in produzione", () => {
    const url = (v: string, production = true) => get(runChecks(good({ production, env: { ...goodEnv, BETTER_AUTH_URL: v } })), "auth.url");
    expect(url("https://casa.example.it").level).toBe("ok");
    expect(url("http://casa.example.it").level).toBe("errore");
    expect(url("http://localhost:3000", false).level).toBe("ok");
    expect(url("https://casa.example.it/app").level).toBe("errore");
    expect(url("https://casa.example.it/").level).toBe("errore");
    expect(url("non un url").level).toBe("errore");
  });

  it("database: non raggiungibile = errore; lento = avviso; non raccolto = controlli dipendenti non verificabili", () => {
    expect(get(runChecks(good({ database: { connected: false } })), "db.connection").level).toBe("errore");
    expect(get(runChecks(good({ database: { connected: true, latencyMs: 2000 } })), "db.connection").level).toBe("avviso");
    const l = levels(good({ database: null, migrations: null, ownerCount: null, lastBackupAt: null, audit: null }));
    expect([l["db.migrations"], l["owner.exists"], l["backup.age"], l["audit.chain"]]).toEqual(["avviso", "avviso", "avviso", "avviso"]);
  });

  it("migrazioni: mancanti = errore con il nome; in piu' = errore; tabella assente = errore", () => {
    const m = (appliedMillis: number[] | null) => get(runChecks(good({ migrations: { journal, appliedMillis } })), "db.migrations");
    expect(m([1000, 2000]).level).toBe("ok");
    expect(m([1000])).toMatchObject({ level: "errore" });
    expect(m([1000]).message).toContain("0001_b");
    expect(m([1000, 2000, 3000])).toMatchObject({ level: "errore", message: expect.stringContaining("non conosce") });
    expect(m(null).level).toBe("errore");
  });

  it("proprietario: assente = errore; token ancora impostato = avviso", () => {
    expect(get(runChecks(good({ ownerCount: 0 })), "owner.exists").level).toBe("errore");
    expect(get(runChecks(good({ ownerCount: 2 })), "owner.exists").level).toBe("errore");
    const withToken = runChecks(good({ env: { ...goodEnv, OWNER_BOOTSTRAP_TOKEN: "t".repeat(40) } }));
    expect(get(withToken, "owner.token").level).toBe("avviso");
    expect(get(runChecks(good()), "owner.token").level).toBe("ok");
  });

  it("cartelle non scrivibili = errore", () => {
    const l = levels(good({ storage: { dir: ".storage", writable: false }, backupDir: { dir: "backups", writable: false } }));
    expect([l["storage.writable"], l["backup.writable"]]).toEqual(["errore", "errore"]);
  });

  it("chiave dei backup: assente = avviso; pubblica = ok; PRIVATA = errore; spazzatura = errore", () => {
    const key = (v: string | undefined) => get(runChecks(good({ env: { ...goodEnv, BACKUP_PUBLIC_KEY: v } })), "backup.key");
    expect(key(undefined).level).toBe("avviso");
    expect(key(publicKey).level).toBe("ok"); // anche con i ritorni a capo veri
    expect(key(oneLine(privateKey)).level).toBe("errore");
    expect(key(oneLine(privateKey)).message).toContain("PRIVATA");
    expect(key("-----BEGIN PUBLIC KEY-----\nxxx\n-----END PUBLIC KEY-----").level).toBe("errore");
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(key(ec).level).toBe("errore");
  });

  it("eta' dell'ultimo backup", () => {
    const age = (d: Date | null | undefined) => get(runChecks(good({ lastBackupAt: d })), "backup.age");
    expect(age(new Date("2026-10-06T05:00:00Z")).level).toBe("ok");
    expect(age(new Date("2026-09-20T05:00:00Z")).level).toBe("avviso");
    expect(age(new Date("2026-09-20T05:00:00Z")).message).toContain("16 giorni");
    expect(age(undefined).level).toBe("avviso");
  });

  it("catena dell'audit: anomalia = errore con la riga", () => {
    const o = get(runChecks(good({ audit: { intact: false, firstBrokenSeq: 17 } })), "audit.chain");
    expect(o.level).toBe("errore");
    expect(o.message).toContain("17");
  });

  it("CRON_SECRET: assente = errore in produzione e avviso fuori; corto = errore", () => {
    const cron = (v: string | undefined, production: boolean) => get(runChecks(good({ production, env: { ...goodEnv, CRON_SECRET: v } })), "cron.secret").level;
    expect(cron(undefined, true)).toBe("errore");
    expect(cron(undefined, false)).toBe("avviso");
    expect(cron("corto", false)).toBe("errore");
    expect(cron("x".repeat(16), true)).toBe("ok");
  });

  it("email: assente o a meta' = avviso informativo, mai errore", () => {
    const mail = (env: Record<string, string | undefined>) => get(runChecks(good({ env: { ...goodEnv, RESEND_API_KEY: undefined, MAIL_FROM: undefined, ...env } })), "mail.config");
    expect(mail({}).level).toBe("avviso");
    expect(mail({ RESEND_API_KEY: "k" }).level).toBe("avviso");
    expect(mail({ RESEND_API_KEY: "k", MAIL_FROM: "Casa <a@example.it>" }).level).toBe("ok");
  });

  it("x-real-ip: promemoria informativo (non verificabile da qui) senza sporcare un'installazione sana", () => {
    expect(get(runChecks(good()), "auth.client_ip").level).toBe("ok");
    expect(get(runChecks(good()), "auth.client_ip").remedy).toContain("x-real-ip");
    expect(get(runChecks(good({ production: false })), "auth.client_ip").level).toBe("ok");
  });

  it("il codice di uscita e' 1 solo con almeno un errore (gli avvisi non bastano)", () => {
    expect(formatReport(runChecks(good({ lastBackupAt: undefined }))).exitCode).toBe(0);
    expect(formatReport(runChecks(good({ ownerCount: 0 }))).exitCode).toBe(1);
  });
});
