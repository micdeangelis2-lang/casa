/**
 * Regole di esempio: un insieme minimo e ILLUSTRATIVO per mostrare come funziona il motore. Sono tutte «da verificare».
 * Non sono norme ne' consulenza: il contenuto vero va deciso dal proprietario con un professionista.
 * L'esempio comunale si lega a un Comune scelto dall'utente (nessun Comune e' scritto nel codice).
 */
const SOURCE = "Esempio illustrativo fornito con l'app: non è una norma né una consulenza. Da confermare con un professionista.";

export type SeedRule = { key: string; input: Record<string, unknown> };

export function exampleRules(options: { municipalityId?: string } = {}): SeedRule[] {
  const base = { sourceText: SOURCE, verificationStatus: "to_verify", changeNote: "Regola di esempio" };
  const rules: SeedRule[] = [
    {
      key: "esempio_titolo",
      input: {
        ...base,
        title: "Esempio: documenti di titolo e provenienza",
        description: "Per ogni bene si tiene l'atto con cui è stato acquisito.",
        level: "national",
        outcomes: [{ type: "checklist", key: "atto_provenienza", title: "Atto di provenienza (compravendita, successione o donazione)", dossierCategory: "title", expectedDocumentCategory: "title_deed" }],
      },
    },
    {
      key: "esempio_catasto",
      input: {
        ...base,
        title: "Esempio: documenti catastali",
        description: "Si applica a ogni bene che non sia un terreno.",
        level: "national",
        appliesWhen: { not: { op: "eq", path: "asset.kind", value: "land" } },
        outcomes: [
          { type: "checklist", key: "visura", title: "Visura catastale aggiornata", dossierCategory: "cadastre", expectedDocumentCategory: "cadastral" },
          { type: "checklist", key: "planimetria", title: "Planimetria catastale", dossierCategory: "cadastre", expectedDocumentCategory: "cadastral" },
        ],
      },
    },
    {
      key: "esempio_condominio",
      input: {
        ...base,
        title: "Esempio: documenti del condominio",
        description: "Si applica ai beni che fanno parte di un condominio.",
        level: "national",
        appliesWhen: { op: "eq", path: "asset.inCondominium", value: true },
        outcomes: [
          { type: "checklist", key: "regolamento", title: "Regolamento di condominio e tabelle millesimali", dossierCategory: "condominium", expectedDocumentCategory: "condominium" },
          { type: "checklist", key: "verbale", title: "Ultimo verbale di assemblea", dossierCategory: "condominium", expectedDocumentCategory: "condominium" },
        ],
      },
    },
    {
      key: "esempio_impianti",
      input: {
        ...base,
        title: "Esempio: documentazione degli impianti",
        description: "Si applica se tra le caratteristiche tecniche è indicato l'anno di costruzione (attributo anno_costruzione). Mostra come una regola usa le caratteristiche del bene.",
        level: "national",
        appliesWhen: { op: "exists", path: "attributes.anno_costruzione" },
        outcomes: [{ type: "checklist", key: "documentazione_impianti", title: "Documentazione degli impianti", dossierCategory: "systems", expectedDocumentCategory: "systems", note: "Elettrico, termico, gas: secondo ciò che esiste nel bene." }],
      },
    },
    {
      key: "esempio_promemoria",
      input: {
        ...base,
        title: "Esempio: promemoria annuale",
        description: "Mostra una scadenza prodotta da una regola: un promemoria ogni anno, relativo a una data (non è una scadenza di legge).",
        level: "national",
        outcomes: [
          {
            type: "deadline",
            key: "controllo_annuale",
            title: "Controllo annuale del dossier",
            category: "administrative",
            calc: { type: "fixed_annual", month: 1, day: 31 },
            shiftToBusinessDay: true,
            priority: "low",
            consequences: "Nessuna: è un promemoria personale.",
          },
        ],
      },
    },
    {
      key: "esempio_comproprieta",
      input: {
        ...base,
        title: "Esempio: avviso sui beni con più titolari",
        level: "national",
        appliesWhen: { op: "contains", path: "rights.regimes", value: "co_ownership" },
        outcomes: [{ type: "notice", key: "piu_titolari", title: "Bene con più titolari", message: "Con più titolari conviene verificare con un professionista come sono ripartiti oneri e decisioni." }],
      },
    },
  ];
  if (options.municipalityId) {
    rules.push({
      key: "esempio_comunale",
      input: {
        ...base,
        title: "Esempio comunale: ricevute dei tributi locali",
        description: "Mostra una regola legata a un solo Comune. Il contenuto reale (quali tributi, quali scadenze) va stabilito per quel Comune.",
        level: "municipal",
        territoryId: options.municipalityId,
        appliesWhen: { op: "in", path: "asset.useType", value: ["primary_residence", "secondary_residence", "let"] },
        outcomes: [{ type: "checklist", key: "ricevute_tributi_locali", title: "Ricevute dei tributi locali dell'anno", dossierCategory: "taxes", expectedDocumentCategory: "taxes" }],
      },
    });
  }
  return rules;
}
