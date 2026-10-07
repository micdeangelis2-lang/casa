import type { ReactNode } from "react";

/**
 * Riquadro che fa scorrere in orizzontale una tabella larga (su un telefono, per esempio). Perche' si possa scorrere anche
 * da tastiera deve poter ricevere il focus e avere un nome: senza, il controllo di accessibilita' lo segnala
 * (`scrollable-region-focusable`) e chi non usa il mouse non vede le colonne fuori schermo.
 */
export function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2">
      {children}
    </div>
  );
}
