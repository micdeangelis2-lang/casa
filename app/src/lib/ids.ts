const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id nell'URL non valido deve dare "non trovato", non un errore del database. */
export const isUuid = (value: string): boolean => UUID.test(value);
