import type { BrowserContext, CDPSession, Page } from "@playwright/test";

/** Credenziale come la descrive il protocollo CDP (WebAuthn.Credential). */
export type WebAuthnCredential = {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  privateKey: string;
  userHandle?: string;
  signCount: number;
  largeBlob?: string;
};

export type VirtualAuthenticator = { cdp: CDPSession; authenticatorId: string };

/**
 * Autenticatore WebAuthn virtuale di Chromium (come i "emulated authenticators" dei DevTools):
 * verifica l'utente in automatico, quindi la cerimonia passkey gira senza hardware.
 */
export async function addVirtualAuthenticator(
  context: BrowserContext,
  page: Page,
): Promise<VirtualAuthenticator> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

export async function exportCredentials({ cdp, authenticatorId }: VirtualAuthenticator) {
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  return credentials;
}

export async function importCredentials(
  { cdp, authenticatorId }: VirtualAuthenticator,
  credentials: WebAuthnCredential[],
) {
  for (const credential of credentials) {
    await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  }
}
