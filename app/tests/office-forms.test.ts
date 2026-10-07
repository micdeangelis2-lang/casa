import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like, sql } from "drizzle-orm";
import { auditLog } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createParty } from "@/modules/directory";
import { createFormTemplate, listFormTemplates, setFormTemplateArchived, updateFormTemplate } from "@/modules/offices";
import { parseChecklist } from "@/modules/offices/domain/form-template";
import messages from "../messages/it.json";
import { conclusiveClaims } from "./helpers/neutral";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;
const NOBODY = "00000000-0000-4000-8000-000000000000";
const TODAY = "2026-10-07";

describe("modulistica degli uffici: logica pura", () => {
  it("la checklist: una voce per riga, spazi e punti elenco tolti, righe vuote e doppioni ignorati", () => {
    expect(parseChecklist("  Documento di identità \r\n\n- Visura\n* visura\n• Planimetria\nDocumento di identità")).toEqual(["Documento di identità", "Visura", "Planimetria"]);
    expect(parseChecklist("")).toEqual([]);
  });

  it("i messaggi dell'area non suonano come verdetti", () => {
    const texts: string[] = [];
    const walk = (n: unknown) => (typeof n === "string" ? texts.push(n) : n && typeof n === "object" ? Object.values(n).forEach(walk) : undefined);
    walk(messages.officeForms);
    expect(texts.flatMap(conclusiveClaims)).toEqual([]);
  });
});

describe("modulistica degli uffici", () => {
  let t: TestDb;
  let officeId: string;
  let otherOfficeId: string;
  let personId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    officeId = okValue(await run((uow) => createParty(uow, { displayName: "Ufficio Esempio", roles: ["public_office"] }))).id;
    otherOfficeId = okValue(await run((uow) => createParty(uow, { displayName: "Altro Ufficio", roles: ["public_office"] }))).id;
    personId = okValue(await run((uow) => createParty(uow, { displayName: "Persona Esempio", roles: ["tenant"] }))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it("annota un modulo con checklist, fonte, data e stato; controlla l'ufficio e i campi", async () => {
    const base = { officePartyId: officeId, name: "Modulo di prova", checklist: "Documento A\nDocumento B", source: "Sportello, ottobre" };
    expect(await run((uow) => createFormTemplate(uow, { ...base, name: "" }))).toMatchObject({ ok: false, errors: { name: expect.any(Array) } });
    expect(await run((uow) => createFormTemplate(uow, { ...base, officePartyId: NOBODY }))).toMatchObject({ ok: false, errors: { officePartyId: ["Il contatto non è un ufficio della rubrica"] } });
    expect(await run((uow) => createFormTemplate(uow, { ...base, officePartyId: personId }))).toMatchObject({ ok: false, errors: { officePartyId: expect.any(Array) } });
    expect(await run((uow) => createFormTemplate(uow, { ...base, verificationStatus: "boh" }))).toMatchObject({ ok: false, errors: { verificationStatus: expect.any(Array) } });
    expect(await run((uow) => createFormTemplate(uow, { ...base, verificationStatus: "verified_by_owner" }))).toMatchObject({ ok: false, errors: { verifiedOn: ["Indica la data in cui hai verificato il modulo"] } });
    expect(await run((uow) => createFormTemplate(uow, { ...base, checklist: Array.from({ length: 51 }, (_, i) => `Voce ${i}`).join("\n") }))).toMatchObject({ ok: false, errors: { checklist: expect.any(Array) } });
    expect(await run((uow) => createFormTemplate(uow, { ...base, checklist: "x".repeat(201) }))).toMatchObject({ ok: false, errors: { checklist: expect.any(Array) } });

    const id = okValue(await run((uow) => createFormTemplate(uow, base))).id;
    const [row] = await listFormTemplates(t.db, { officePartyId: officeId }, TODAY);
    expect(row).toMatchObject({ id, name: "Modulo di prova", checklist: ["Documento A", "Documento B"], source: "Sportello, ottobre", verifiedOn: null, verificationStatus: "to_verify", state: "unverified", archived: false });
    expect(await listFormTemplates(t.db, { officePartyId: otherOfficeId }, TODAY)).toEqual([]);
  });

  it("lo stato dipende dallo stato scritto e dall'eta' dell'ultima verifica, non dal contenuto", async () => {
    const id = (await listFormTemplates(t.db, { officePartyId: officeId }, TODAY))[0]!.id;
    const edit = (over: Record<string, unknown>) => run((uow) => updateFormTemplate(uow, id, { officePartyId: officeId, name: "Modulo di prova", checklist: "Documento A", ...over }));
    expect(await run((uow) => updateFormTemplate(uow, NOBODY, { officePartyId: officeId, name: "x" }))).toMatchObject({ ok: false });
    expect(await edit({ verificationStatus: "verified_by_owner", verifiedOn: "2026-09-01" })).toMatchObject({ ok: true });
    expect((await listFormTemplates(t.db, { officePartyId: officeId }, TODAY))[0]).toMatchObject({ checklist: ["Documento A"], state: "recent" });
    expect((await listFormTemplates(t.db, { officePartyId: officeId }, "2028-01-01"))[0]!.state).toBe("stale");
    expect((await listFormTemplates(t.db, { officePartyId: officeId }, "2028-01-01", 36))[0]!.state).toBe("recent");
    expect(await edit({ verificationStatus: "validated_by_professional", verifiedOn: "" })).toMatchObject({ ok: false, errors: { verifiedOn: expect.any(Array) } });
    expect(await edit({ officePartyId: personId, verificationStatus: "draft" })).toMatchObject({ ok: false, errors: { officePartyId: expect.any(Array) } });
    expect(await edit({ verificationStatus: "draft", verifiedOn: "" })).toMatchObject({ ok: true });
    expect((await listFormTemplates(t.db, { officePartyId: officeId }, TODAY))[0]!.state).toBe("unverified");
  });

  it("archivia e ripristina; l'audit non contiene nomi, voci o fonti", async () => {
    const id = (await listFormTemplates(t.db, { officePartyId: officeId }, TODAY))[0]!.id;
    expect(await run((uow) => setFormTemplateArchived(uow, NOBODY, true))).toMatchObject({ ok: false });
    expect(await run((uow) => setFormTemplateArchived(uow, id, true))).toMatchObject({ ok: true });
    expect(await listFormTemplates(t.db, { officePartyId: officeId }, TODAY)).toEqual([]);
    expect((await listFormTemplates(t.db, { officePartyId: officeId, includeArchived: true }, TODAY))[0]!.archived).toBe(true);
    expect(await run((uow) => setFormTemplateArchived(uow, id, false))).toMatchObject({ ok: true });
    expect(await listFormTemplates(t.db, { officePartyId: officeId }, TODAY)).toHaveLength(1);

    const rows = await t.db.select().from(auditLog).where(like(auditLog.action, "office.form.%"));
    const text = JSON.stringify(rows.map((r) => r.diff));
    for (const secret of ["Modulo di prova", "Documento A", "Sportello"]) expect(text).not.toContain(secret);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["office.form.create", "office.form.update", "office.form.archive", "office.form.restore"]));
    await expect(t.db.execute(sql`update office_form_template set verification_status = 'boh'`)).rejects.toThrow();
  });
});
