"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

// Nessun baseURL: il client usa l'origine corrente, la stessa che il server ha in BETTER_AUTH_URL.
export const authClient = createAuthClient({
  plugins: [passkeyClient(), twoFactorClient()],
});
