import { optionalText, requiredText, z } from "@/shared/zod";

/** Ruoli possibili di un contatto; ne puo' avere piu' di uno. Le etichette italiane stanno in messages/it.json. */
export const PARTY_ROLES = [
  "owner",
  "co_owner",
  "tenant",
  "administrator",
  "lawyer",
  "accountant",
  "notary",
  "surveyor",
  "technician",
  "insurer",
  "adjuster",
  "agent",
  "manager",
  "supplier",
  "public_office",
  "other",
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const partyInputSchema = z.object({
  displayName: requiredText("Nome", 160),
  roles: z.array(z.enum(PARTY_ROLES, { error: "Ruolo non valido" })).default([]),
  taxCode: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.replace(/\s+/g, "").toUpperCase()) : v),
    z
      .string()
      .regex(/^[A-Z0-9]{11,16}$/, "Codice fiscale o partita IVA: 11-16 caratteri tra lettere e cifre")
      .optional(),
  ),
  email: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim().toLowerCase()) : v),
    z.email("Indirizzo email non valido").max(254).optional(),
  ),
  pec: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim().toLowerCase()) : v),
    z.email("Indirizzo PEC non valido").max(254).optional(),
  ),
  phone: optionalText(40),
  address: optionalText(300),
  notes: optionalText(2000),
});

export type PartyInput = z.infer<typeof partyInputSchema>;

export type Party = {
  id: string;
  displayName: string;
  roles: PartyRole[];
  taxCode: string | null;
  email: string | null;
  pec: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  archived: boolean;
};
