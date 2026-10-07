import { describe, expect, it } from "vitest";
import { buildCsv, buildIndexHtml, buildManifest, exceedsCap, packageInputSchema, safeFileName, type ManifestInput, type PackageItemInfo } from "@/modules/sharing/domain/sharing";

const item = (o: Partial<PackageItemInfo> = {}): PackageItemInfo => ({
  path: "documenti/a.pdf", title: "Atto", categoryName: "Titoli", confidentiality: "ordinary", issuerName: null, issuedOn: null, validFrom: null, validTo: null,
  verificationStatus: "draft", mimeType: "application/pdf", sizeBytes: 10, sha256: "a".repeat(64), overrideAboveCap: false, assetNames: [], ...o,
});
const manifest = (o: Partial<ManifestInput> = {}): ManifestInput => ({ createdAt: "2026-06-15T10:00:00.000Z", recipientType: "notary", recipientName: "Studio", confidentialityCap: "reserved", note: null, items: [], ...o });
const labels = {
  recipient: { administrator: "A", technician: "T", lawyer: "L", notary: "Notaio", accountant: "C", insurer: "I", tenant: "Inq", manager: "M", agent: "Ag", other: "Altro" },
  confidentiality: { ordinary: "Ordinario", reserved: "Riservato", highly_reserved: "Molto riservato" },
  verification: { draft: "Bozza" } as Record<string, string>,
};

describe("pacchetti di condivisione: casi limite del dominio", () => {
  it("il tetto di riservatezza: stesso livello non eccede, uno piu' alto si; il minimo non eccede mai", () => {
    expect(exceedsCap("ordinary", "ordinary")).toBe(false);
    expect(exceedsCap("reserved", "ordinary")).toBe(true);
    expect(exceedsCap("highly_reserved", "reserved")).toBe(true);
    expect(exceedsCap("ordinary", "highly_reserved")).toBe(false);
  });

  it("nomi di file: accenti tolti, percorsi neutralizzati, punti iniziali tolti, lunghezza limitata, vuoto = «documento»", () => {
    expect(safeFileName("Perizia è già fatta.pdf")).toBe("Perizia_e_gia_fatta.pdf");
    expect(safeFileName("../../etc/passwd")).toBe("etc_passwd");
    expect(safeFileName("...")).toBe("documento");
    expect(safeFileName("")).toBe("documento");
    expect(safeFileName("日本語")).toBe("documento");
    expect(safeFileName(".htaccess")).toBe("htaccess");
    expect(safeFileName(`${"x".repeat(200)}.pdf`)).toHaveLength(80);
    expect(safeFileName(`${"x".repeat(200)}.pdf`).endsWith(".pdf")).toBe(true);
  });

  it("lo schema accetta un pacchetto con la sola scheda (zero documenti), ma non piu' di 500 documenti ne' id non validi", () => {
    const base = { recipientType: "notary", recipientName: "Studio", confidentialityCap: "reserved" };
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(packageInputSchema.safeParse({ ...base, documents: [] }).success).toBe(true);
    expect(packageInputSchema.safeParse({ ...base, documents: Array.from({ length: 500 }, () => ({ documentId: id })) }).success).toBe(true);
    expect(packageInputSchema.safeParse({ ...base, documents: Array.from({ length: 501 }, () => ({ documentId: id })) }).success).toBe(false);
    expect(packageInputSchema.safeParse({ ...base, documents: [{ documentId: "x" }] }).success).toBe(false);
    expect(packageInputSchema.safeParse({ ...base, recipientType: "hacker", documents: [] }).success).toBe(false);
    expect(packageInputSchema.safeParse({ ...base, recipientName: "  ", documents: [] }).success).toBe(false);
  });

  it("l'indice HTML esce da markup e virgolette: titoli, destinatario e nota ostili restano testo", () => {
    const html = buildIndexHtml(
      manifest({ recipientName: '<img src=x onerror="alert(1)">', note: "</p><script>alert(1)</script>", items: [item({ title: '"><script>x</script>', path: 'a"onmouseover="x', issuerName: "Mario & C.", assetNames: ["<b>Casa</b>"] })] }),
      labels,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="a"onmouseover');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Mario &amp; C.");
    expect(html).toContain("&quot;&gt;&lt;script&gt;x");
  });

  it("l'indice HTML: date in italiano, intervallo di validita' solo se ci sono entrambe, etichetta «oltre il livello», verifica sconosciuta in chiaro, elenco vuoto", () => {
    const html = buildIndexHtml(
      manifest({ items: [item({ issuedOn: "2026-03-05", validFrom: "2026-01-01", validTo: "2027-01-31", overrideAboveCap: true, verificationStatus: "stato_nuovo" }), item({ title: "Solo fine", validTo: "2027-01-31", confidentiality: "highly_reserved" })] }),
      labels,
    );
    expect(html).toContain("05/03/2026");
    expect(html).toContain("01/01/2026 – 31/01/2027");
    expect(html).toContain("incluso oltre il livello scelto");
    expect(html).toContain("stato_nuovo");
    expect(html).toContain("<td>31/01/2027</td>");
    expect(html).toContain("Molto riservato");
    expect(buildIndexHtml(manifest(), labels)).toContain("<strong>Documenti:</strong> 0");
    expect(buildIndexHtml(manifest(), labels)).not.toContain("Nota del proprietario");
    expect(html).not.toMatch(/conforme|in regola/i);
  });

  it("manifest e CSV con zero elementi sono JSON/CSV validi; il manifest non riporta la scheda se non c'e'", () => {
    const parsed = JSON.parse(buildManifest(manifest()));
    expect(parsed).toMatchObject({ sheet: null, files: [], recipient: { type: "notary", name: "Studio" } });
    const csv = buildCsv([]);
    expect(csv.split("\n").filter(Boolean)).toHaveLength(1);
  });
});
