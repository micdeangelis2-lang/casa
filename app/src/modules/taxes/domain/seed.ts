import type { TaxKind } from "./taxes";

/**
 * Tipi di tributo italiani comuni predefiniti (illustrativi).
 * L'app non calcola le imposte né conosce le aliquote: i tipi servono a organizzare
 * le voci per bene e anno e a produrre il riepilogo per il consulente fiscale.
 */
export type SeedTaxType = {
  name: string;
  kind: TaxKind;
  source?: string;
  notes?: string;
};

export const DEFAULT_TAX_TYPES: readonly SeedTaxType[] = [
  {
    name: "IMU (Imposta Municipale Propria)",
    kind: "tax",
    source: "Normativa statale e delibere comunali aliquote",
    notes: "Imposta municipale sugli immobili (seconde case, locati o immobili di lusso A/1, A/8, A/9). Solitamente acconto a giugno e saldo a dicembre.",
  },
  {
    name: "TARI (Tassa sui Rifiuti)",
    kind: "levy",
    source: "Avviso di pagamento del Comune o del gestore ambientale",
    notes: "Tassa / tariffa per il servizio di raccolta e smaltimento rifiuti. Scadenze e rate definite dal regolamento comunale.",
  },
  {
    name: "Imposta di registro (Locazioni)",
    kind: "tax",
    source: "Agenzia delle Entrate (Modello RLI / F24 Elide)",
    notes: "Dovuta per registrazione o proroga/rinnovo annuale dei contratti di locazione in regime ordinario.",
  },
  {
    name: "Imposta di bollo",
    kind: "tax",
    source: "DPR 642/1972",
    notes: "Dovuta su contratti di locazione in regime ordinario, quietanze o istanze ad enti pubblici.",
  },
  {
    name: "Canone Unico Patrimoniale (CUP)",
    kind: "due",
    source: "Regolamento comunale per l'occupazione di suolo e passi carrabili",
    notes: "Ex TOSAP/COSAP e imposta di pubblicità. Riguarda passi carrabili, occupazione di suolo pubblico o insegne.",
  },
  {
    name: "Contributo di bonifica",
    kind: "due",
    source: "Avviso / cartella del Consorzio di Bonifica",
    notes: "Contributo consortile per gli immobili situati nel perimetro di contribuenza del consorzio.",
  },
  {
    name: "Cedolare secca",
    kind: "tax",
    source: "D.Lgs. 23/2011 - Modello Redditi / 730 / F24",
    notes: "Imposta sostitutiva per i redditi da locazione abitativa (acconto e saldo).",
  },
] as const;
