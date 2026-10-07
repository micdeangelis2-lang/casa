/** Stato del modulo contatto: tutto testo, come lo scrive l'utente. File neutro, usabile da pagine (server) e modulo (client). */
export type PartyFormState = {
  displayName: string;
  roles: string[];
  taxCode: string;
  email: string;
  pec: string;
  phone: string;
  address: string;
  notes: string;
};

export const emptyPartyForm = (): PartyFormState => ({
  displayName: "",
  roles: [],
  taxCode: "",
  email: "",
  pec: "",
  phone: "",
  address: "",
  notes: "",
});
