import { describe, expect, it } from "vitest";
import { normalizeHeader, parseCsv } from "@/modules/import/domain/csv-reader";

const BOM = String.fromCharCode(0xfeff);
const okOf = (text: string) => {
  const r = parseCsv(text);
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe("lettore CSV", () => {
  it("legge BOM, CRLF e separatore punto e virgola", () => {
    const r = okOf(`${BOM}nome;email\r\nAnna;a@x.test\r\nBruno;b@x.test\r\n`);
    expect(r.delimiter).toBe(";");
    expect(r.headers).toEqual(["nome", "email"]);
    expect(r.rows.map((x) => x.cells)).toEqual([["Anna", "a@x.test"], ["Bruno", "b@x.test"]]);
    expect(r.rows.map((x) => x.line)).toEqual([2, 3]);
  });

  it("rileva la virgola, accetta LF e taglia gli spazi", () => {
    const r = okOf("nome , email\n  Anna , a@x.test  \n");
    expect(r.delimiter).toBe(",");
    expect(r.headers).toEqual(["nome", "email"]);
    expect(r.rows[0]!.cells).toEqual(["Anna", "a@x.test"]);
  });

  it("gestisce virgolette raddoppiate, separatori e a capo interni", () => {
    const r = okOf('nome;note\r\n"Rossi; ""Mario""";"riga 1\r\nriga 2"\r\nUltimo;x\r\n');
    expect(r.rows[0]!.cells).toEqual(['Rossi; "Mario"', "riga 1\nriga 2"]);
    expect(r.rows[1]!.line).toBe(4);
  });

  it("ignora le righe vuote e quelle di soli separatori", () => {
    const r = okOf("a;b\r\n\r\n1;2\r\n;\r\n   \r\n3;4");
    expect(r.rows.map((x) => x.cells)).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("segnala virgolette non chiuse con la riga", () => {
    const r = parseCsv('a;b\r\n1;"aperta\r\n2;3\r\n');
    expect(r).toEqual({ ok: false, message: "Riga 2: virgolette aperte e mai chiuse." });
  });

  it("segnala testo dopo le virgolette di chiusura", () => {
    const r = parseCsv('a;b\r\n"x"y;2\r\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/^Riga 2:/);
  });

  it("restituisce righe con colonne in più o in meno senza scartarle", () => {
    const r = okOf("a;b;c\r\n1;2\r\n1;2;3;4\r\n");
    expect(r.rows.map((x) => x.cells.length)).toEqual([2, 4]);
  });

  it("con separatore misto le righe risultano di lunghezza diversa", () => {
    const r = okOf("a;b;c\r\n1,2,3\r\n");
    expect(r.delimiter).toBe(";");
    expect(r.rows[0]!.cells).toEqual(["1,2,3"]);
  });

  it("rifiuta file vuoto, solo intestazione e solo spazi", () => {
    for (const text of ["", BOM, "  \r\n \r\n"]) {
      const r = parseCsv(text);
      expect(r).toEqual({ ok: false, message: "Il file è vuoto." });
    }
    const only = parseCsv("a;b\r\n");
    expect(only.ok).toBe(false);
  });

  it("accetta 500 righe e rifiuta la 501", () => {
    const body = (n: number) => Array.from({ length: n }, (_, i) => `r${i};x`).join("\r\n");
    expect(okOf(`a;b\r\n${body(500)}\r\n`).rows).toHaveLength(500);
    const r = parseCsv(`a;b\r\n${body(501)}\r\n`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("troppe righe");
  });

  it("applica i tetti di colonne e di dimensione", () => {
    const wide = Array.from({ length: 61 }, (_, i) => `c${i}`).join(";");
    const r = parseCsv(`${wide}\r\n1\r\n`);
    expect(r.ok).toBe(false);
    const big = parseCsv(`a;b\r\n${"x".repeat(30)};y\r\n`, { maxChars: 20, maxRows: 5, maxColumns: 5 });
    expect(big.ok).toBe(false);
  });

  it("rifiuta i caratteri di controllo", () => {
    const r = parseCsv("a;b\r\n1;2\u0000\r\n");
    expect(r.ok).toBe(false);
  });

  it("confronta le intestazioni senza maiuscole, accenti e spazi", () => {
    expect(normalizeHeader(" Località ")).toBe("localita");
    expect(normalizeHeader("Codice Fiscale / P.IVA")).toBe("codicefiscalepiva");
  });
});
