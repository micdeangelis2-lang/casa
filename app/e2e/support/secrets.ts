import type { WebAuthnCredential } from "./webauthn";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Segreti del proprietario di PROVA creati dal setup e riusati dagli altri test. Non versionati. */
export const AUTH_DIR = resolve(__dirname, "../.auth");
export const STORAGE_STATE = resolve(AUTH_DIR, "state.json");
const SECRETS_FILE = resolve(AUTH_DIR, "secrets.json");

export type OwnerSecrets = {
  totpSecret: string;
  backupCodes: string[];
  credentials: WebAuthnCredential[];
};

export function saveSecrets(secrets: OwnerSecrets): void {
  mkdirSync(dirname(SECRETS_FILE), { recursive: true });
  writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2));
}

export function loadSecrets(): OwnerSecrets {
  return JSON.parse(readFileSync(SECRETS_FILE, "utf8")) as OwnerSecrets;
}
