import type { ReactNode } from "react";
import { ScrollRegion } from "@/components/scroll-region";

/** Tabella di sola lettura per le viste di gestione: la prima cella di ogni riga e' l'intestazione di riga. */
export function GestoreTable({ label, testId, headers, rows, footer }: { label: string; testId: string; headers: string[]; rows: { key: string; cells: ReactNode[] }[]; footer?: ReactNode }) {
  return (
    <ScrollRegion label={label}>
      <table className="w-full text-left text-sm" data-testid={testId}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b">
            {headers.map((h) => (
              <th key={h} scope="col" className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b">
              {r.cells.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="py-2 pr-4 text-left align-top font-normal">
                    {c}
                  </th>
                ) : (
                  <td key={i} className="py-2 pr-4 align-top">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </ScrollRegion>
  );
}
