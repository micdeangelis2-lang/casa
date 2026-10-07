/** Il tempo e' sempre iniettato: dominio e scadenze restano deterministici e testabili. */
export interface ClockPort {
  now(): Date;
}

export const systemClock: ClockPort = {
  now: () => new Date(),
};

/** La data di calendario di oggi in Italia (AAAA-MM-GG): scadenze e validita' ragionano in giorni, non in istanti UTC. */
export function todayInItaly(clock: ClockPort = systemClock): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(clock.now());
}
