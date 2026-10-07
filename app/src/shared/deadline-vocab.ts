/** Vocabolario delle scadenze condiviso da regole (che le producono) e modulo Scadenze (che le gestisce). */
export const DEADLINE_CATEGORIES = ["fiscal", "insurance", "technical", "condominium", "contractual", "letting", "hospitality", "administrative", "other"] as const;
export type DeadlineCategory = (typeof DEADLINE_CATEGORIES)[number];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Livelli normativi (stessi delle regole). */
export const LEVELS = ["national", "regional", "municipal", "condominium", "contract"] as const;
