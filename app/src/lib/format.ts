import { formatCents } from "@/shared/money";

/** "2026-03-15" -> "15/3/2026" (data di calendario, senza fusi orari). */
export const formatDate = (value: string): string => new Date(`${value}T00:00:00`).toLocaleDateString("it-IT");

/** Centesimi -> "1.234,56" (senza simbolo: il simbolo lo mette il testo che lo usa). */
export const formatEuro = (cents: number): string => formatCents(cents);
