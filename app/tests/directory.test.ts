import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc } from "drizzle-orm";
import { auditLog } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createParty, ensureOwnerParty, getParty, listParties, setPartyArchived, updateParty } from "@/modules/directory";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;

describe("rubrica", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);

  it("crea un contatto con piu' ruoli e normalizza i dati", async () => {
    const result = await run((uow) =>
      createParty(uow, {
        displayName: "  Studio Esempio  ",
        roles: ["accountant", "supplier"],
        taxCode: "ab12 3456 7890 1",
        email: "INFO@Esempio.TEST",
        phone: "",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      displayName: "Studio Esempio",
      roles: ["accountant", "supplier"],
      taxCode: "AB123456789 01".replace(" ", ""),
      email: "info@esempio.test",
      phone: null,
    });
  });

  it("mostra errori chiari in italiano sui campi sbagliati", async () => {
    const result = await run((uow) => createParty(uow, { displayName: "", roles: ["mago"], email: "non-una-email", taxCode: "x" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.displayName?.[0]).toBe("Nome: campo obbligatorio");
    expect(result.errors.email?.[0]).toBe("Indirizzo email non valido");
    expect(result.errors.taxCode?.[0]).toMatch(/Codice fiscale/);
    expect(Object.keys(result.errors).some((k) => k.startsWith("roles"))).toBe(true);
  });

  it("filtra per ruolo e per testo, e nasconde gli archiviati", async () => {
    await run((uow) => createParty(uow, { displayName: "Notaio Rossi", roles: ["notary"] }));
    const archived = await run((uow) => createParty(uow, { displayName: "Vecchio Fornitore", roles: ["supplier"] }));
    if (!archived.ok) throw new Error("setup");
    await run((uow) => setPartyArchived(uow, archived.value.id, true));

    expect((await listParties(t.db, { role: "notary" })).map((p) => p.displayName)).toEqual(["Notaio Rossi"]);
    expect((await listParties(t.db, { query: "esempio" })).map((p) => p.displayName)).toEqual(["Studio Esempio"]);
    expect((await listParties(t.db)).map((p) => p.displayName)).not.toContain("Vecchio Fornitore");
    expect((await listParties(t.db, { includeArchived: true })).map((p) => p.displayName)).toContain("Vecchio Fornitore");
  });

  it("aggiorna e registra nell'audit solo i NOMI dei campi cambiati, mai i valori", async () => {
    const created = await run((uow) => createParty(uow, { displayName: "Da Modificare", roles: [], phone: "123456" }));
    if (!created.ok) throw new Error("setup");
    await run((uow) => updateParty(uow, created.value.id, { displayName: "Da Modificare", roles: ["lawyer"], phone: "999999" }));
    const [last] = await t.db.select().from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
    expect(last).toMatchObject({ action: "party.update" });
    expect(last!.diff).toEqual({ changed: ["roles", "phone"] });
    expect(JSON.stringify(last!.diff)).not.toContain("999999");
    expect((await getParty(t.db, created.value.id))?.roles).toEqual(["lawyer"]);
  });

  it("il contatto 'proprietario' si crea una volta sola", async () => {
    const first = await run((uow) => ensureOwnerParty(uow, { displayName: "Mario Prova", email: "mario@example.test" }));
    const second = await run((uow) => ensureOwnerParty(uow, { displayName: "Altro Nome" }));
    expect(second.id).toBe(first.id);
    expect(first.roles).toEqual(["owner"]);
  });

  it("un contatto inesistente non si puo' modificare", async () => {
    const result = await run((uow) =>
      updateParty(uow, "00000000-0000-4000-8000-000000000000", { displayName: "X", roles: [] }),
    );
    expect(result).toEqual({ ok: false, errors: { _: ["Contatto non trovato"] } });
  });
});
