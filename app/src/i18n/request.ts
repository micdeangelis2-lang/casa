import { getRequestConfig } from "next-intl/server";

/**
 * Un'unica lingua (italiano): le stringhe sono comunque esternalizzate
 * in messages/it.json cosi' un'altra lingua si potra' aggiungere senza toccare i componenti.
 */
export default getRequestConfig(async () => {
  const locale = "it";
  return {
    locale,
    messages: (await import("../../messages/it.json")).default,
  };
});
