import { expect, type Locator } from "@playwright/test";

/**
 * Vero quando React ha «idratato» l'elemento: in idratazione React 19 associa ai nodi del DOM le proprie proprieta' in una chiave
 * `__reactProps$...`. Un clic dato PRIMA di questo momento arriva a un pulsante senza gestore e si perde in silenzio: e' la causa
 * delle prove che passano o falliscono a seconda del carico della macchina.
 */
export const isHydrated = (locator: Locator): Promise<boolean> =>
  locator.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps$")));

/** Attende l'idratazione dell'elemento (con un tetto), poi clicca. Da usare sui pulsanti che avviano un'azione lato client. */
export async function clickWhenHydrated(locator: Locator, timeout = 15_000): Promise<void> {
  await expect.poll(() => isHydrated(locator), { timeout, message: "l'elemento non e' stato idratato da React" }).toBe(true);
  await locator.click();
}
