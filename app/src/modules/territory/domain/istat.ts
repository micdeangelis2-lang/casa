/**
 * Lettura dell'elenco ufficiale dei Comuni italiani pubblicato da ISTAT (CSV, separatore ";").
 * Logica pura: il file si scarica e si decodifica altrove (e' in ISO-8859-1).
 *
 * Colonne usate (0-based): 0 codice regione, 1 codice unita' sovracomunale, 4 codice Comune,
 * 6 denominazione in italiano, 10 regione, 11 unita' sovracomunale, 14 sigla automobilistica,
 * 19 codice catastale. Se ISTAT cambia il tracciato, `parseIstatCsv` fallisce invece di importare dati errati.
 */
export type IstatRow = {
  regionCode: string;
  regionName: string;
  provinceCode: string;
  provinceName: string;
  provinceSigla: string;
  municipalityCode: string;
  municipalityName: string;
  cadastralCode: string;
};

const MIN_COLUMNS = 20;

export class IstatFormatError extends Error {}

export function parseIstatCsv(text: string): IstatRow[] {
  const rows: IstatRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(";").map((c) => c.trim().replace(/^"|"$/g, ""));
    // Le righe di intestazione (anche quelle su piu' righe) non iniziano con un codice regione numerico.
    if (cols.length < MIN_COLUMNS || !/^\d+$/.test(cols[0] ?? "")) continue;

    const row: IstatRow = {
      regionCode: cols[0]!,
      provinceCode: cols[1]!,
      municipalityCode: cols[4]!,
      municipalityName: cols[6]!,
      regionName: cols[10]!,
      provinceName: cols[11]!,
      provinceSigla: cols[14]!,
      cadastralCode: cols[19]!,
    };
    if (!/^\d{6}$/.test(row.municipalityCode) || !/^[A-Z]\d{3}$/.test(row.cadastralCode) || !row.municipalityName) {
      throw new IstatFormatError(`Riga ISTAT non riconosciuta: "${line.slice(0, 80)}"`);
    }
    rows.push(row);
  }
  // Un file con pochissime righe significa che il tracciato e' cambiato o che si e' scaricata una pagina d'errore.
  if (rows.length < 1000) {
    throw new IstatFormatError(`Elenco ISTAT non valido: ${rows.length} Comuni letti (ne attendo migliaia).`);
  }
  return rows;
}
