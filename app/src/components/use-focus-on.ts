"use client";

import { useEffect, type RefObject } from "react";

/**
 * Sposta il focus sull'elemento quando `signal` e' valorizzato (es. l'oggetto degli errori, non vuoto). Si fa in un effetto e non
 * con `requestAnimationFrame` subito dopo `setState`: il riepilogo degli errori esiste solo dopo il rendering e, su una macchina
 * lenta, il frame puo' arrivare prima, quando il riferimento e' ancora vuoto.
 */
export function useFocusOn(ref: RefObject<HTMLElement | null>, signal: unknown): void {
  useEffect(() => {
    if (signal) ref.current?.focus();
  }, [ref, signal]);
}
