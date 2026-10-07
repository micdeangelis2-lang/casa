/**
 * Parte del modulo Documenti utilizzabile nei componenti client: solo costanti e tipi del dominio.
 * L'`index.ts` importa lo storage (accesso al disco) e non deve finire nel bundle del browser.
 */
export {
  CONFIDENTIALITY,
  MAX_FILE_BYTES,
  VERIFICATION_STATUS,
  type Confidentiality,
  type VerificationStatus,
} from "./domain/document";
