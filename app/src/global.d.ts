import type messages from "../messages/it.json";

// Chiavi dei messaggi tipizzate: un refuso in una chiave diventa un errore di compilazione.
declare module "next-intl" {
  interface AppConfig {
    Locale: "it";
    Messages: typeof messages;
  }
}
