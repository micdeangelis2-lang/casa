import { describe, expect, it } from "vitest";
import { documentInputSchema, sniffFile, versionInputSchema } from "@/modules/documents/domain/document";

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

describe("documenti: riconoscimento del tipo dai byte (casi limite)", () => {
  it("meno di 4 byte non e' mai un file riconosciuto", () => {
    expect(sniffFile(bytes(), "a.pdf")).toBeNull();
    expect(sniffFile(bytes(0x25, 0x50, 0x44), "a.pdf")).toBeNull();
  });

  it("riconosce PNG, JPEG, GIF (due versioni), WEBP e TIFF (entrambe le endianness)", () => {
    expect(sniffFile(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "x.bin")?.mime).toBe("image/png");
    expect(sniffFile(bytes(0xff, 0xd8, 0xff, 0xe0), "x.bin")?.mime).toBe("image/jpeg");
    expect(sniffFile(text("GIF87a.."), "x.bin")?.mime).toBe("image/gif");
    expect(sniffFile(text("GIF89a.."), "x.bin")?.mime).toBe("image/gif");
    expect(sniffFile(text("RIFF\0\0\0\0WEBPVP8 "), "x.bin")?.mime).toBe("image/webp");
    expect(sniffFile(bytes(0x49, 0x49, 0x2a, 0x00, 1), "x.bin")?.extension).toBe("tif");
    expect(sniffFile(bytes(0x4d, 0x4d, 0x00, 0x2a, 1), "x.bin")?.extension).toBe("tif");
  });

  it("un RIFF che non e' WEBP (per esempio un WAV) viene rifiutato", () => {
    expect(sniffFile(text("RIFF\0\0\0\0WAVEfmt "), "x.webp")).toBeNull();
  });

  it("PNG troncato dopo la firma corta non passa", () => {
    expect(sniffFile(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a), "x.png")).toBeNull();
  });

  it("zip: solo con estensione ammessa (anche maiuscola); i .p7m vogliono 0x30 in testa; il nome senza estensione non basta", () => {
    expect(sniffFile(text("PK\u0003\u0004zz"), "Tabella.XLSX")?.extension).toBe("xlsx");
    expect(sniffFile(text("PK\u0003\u0004zz"), "t.ods")?.extension).toBe("ods");
    expect(sniffFile(text("PK\u0003\u0004zz"), "t.odt")?.extension).toBe("odt");
    expect(sniffFile(text("PK\u0003\u0004zz"), "docx")?.extension).toBe("docx");
    expect(sniffFile(text("PK\u0003\u0004zz"), "t.exe")).toBeNull();
    expect(sniffFile(bytes(0x31, 0x82, 0x01, 0x00), "a.p7m")).toBeNull();
    expect(sniffFile(bytes(0x30, 0x82, 0x01, 0x00), "a.txt")).toBeNull();
  });

  it("un'estensione costruita per ingannare non cambia il tipo vero", () => {
    expect(sniffFile(text("%PDF-1.7 x"), "foto.exe")?.mime).toBe("application/pdf");
    expect(sniffFile(text("<html><script>"), "pagina.pdf")).toBeNull();
  });
});

describe("documenti: schemi dei metadati (casi limite)", () => {
  const base = { title: "Atto", categoryId: "123e4567-e89b-42d3-a456-426614174000" };

  it("l'emittente vuoto del modulo vale «nessun emittente»; uno non valido e' un errore", () => {
    const ok = versionInputSchema.safeParse({ issuerPartyId: "" });
    expect(ok.success && ok.data.issuerPartyId).toBeFalsy();
    expect(versionInputSchema.safeParse({ issuerPartyId: "abc" }).success).toBe(false);
  });

  it("la validita' non puo' finire prima di cominciare, ma puo' finire lo stesso giorno", () => {
    expect(versionInputSchema.safeParse({ validFrom: "2026-05-02", validTo: "2026-05-01" }).success).toBe(false);
    expect(versionInputSchema.safeParse({ validFrom: "2026-05-01", validTo: "2026-05-01" }).success).toBe(true);
    expect(versionInputSchema.safeParse({ validTo: "2026-05-01" }).success).toBe(true);
  });

  it("un documento nuovo ha valori predefiniti prudenti e rifiuta titolo vuoto, beni non validi e date impossibili", () => {
    const r = documentInputSchema.safeParse(base);
    expect(r.success && r.data).toMatchObject({ confidentiality: "ordinary", verificationStatus: "to_verify", assetIds: [] });
    expect(documentInputSchema.safeParse({ ...base, title: "   " }).success).toBe(false);
    expect(documentInputSchema.safeParse({ ...base, assetIds: ["x"] }).success).toBe(false);
    expect(documentInputSchema.safeParse({ ...base, issuedOn: "2026-02-30" }).success).toBe(false);
    expect(documentInputSchema.safeParse({ ...base, confidentiality: "pubblico" }).success).toBe(false);
  });
});
