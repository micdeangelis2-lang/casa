import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvDocument, csvLine } from "@/shared/csv";
import { buildCsv } from "@/modules/sharing/domain/sharing";

describe("CSV", () => {
  it("usa la virgola decimale, mette tra virgolette cio' che contiene il separatore e neutralizza le formule", () => {
    expect(csvCell(12.5)).toBe("12,5");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
    expect(csvCell("semplice")).toBe("semplice");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('dice "ciao"; poi')).toBe('"dice ""ciao""; poi"');
    expect(csvCell("riga\nnuova")).toBe('"riga\nnuova"');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SOMMA(A1)")).toBe("'@SOMMA(A1)");
  });

  it("con le virgolette sempre attive il testo resta tra virgolette e le formule restano neutralizzate", () => {
    expect(csvCell("Atto", { alwaysQuote: true })).toBe('"Atto"');
    expect(csvCell(null, { alwaysQuote: true })).toBe('""');
    expect(csvCell("=HYPERLINK(\"http://x\")", { alwaysQuote: true })).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvLine(["a", 1.5, null])).toBe("a;1,5;");
  });

  it("un documento ha il BOM, le righe unite da CRLF e il fine riga finale", () => {
    const text = csvDocument([["Titolo", "Importo"], ["Prova", 10]]);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text.slice(1)).toBe("Titolo;Importo\r\nProva;10\r\n");
  });

  it("l'elenco dei pacchetti di condivisione, che parte verso terzi, non contiene formule eseguibili", () => {
    const csv = buildCsv([
      {
        path: "files/001-x.pdf",
        title: "=HYPERLINK(\"http://esempio.test\")",
        categoryName: "Categoria",
        assetNames: ["Bene"],
        confidentiality: "ordinary",
        issuerName: null,
        issuedOn: null,
        validFrom: null,
        validTo: null,
        verificationStatus: "to_verify",
        sizeBytes: 1234,
        sha256: "abc",
      } as never,
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""http://esempio.test"")"`);
    expect(csv).not.toContain(`;"=HYPERLINK`);
  });
});
