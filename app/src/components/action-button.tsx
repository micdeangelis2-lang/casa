"use client";

import { useTransition, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";

type Props = Omit<ComponentProps<typeof Button>, "onClick" | "type"> & {
  /** Server action già con i suoi argomenti (`action.bind(null, id)`). */
  action: () => Promise<unknown>;
  /** Testo aggiuntivo per i lettori di schermo (a cosa si riferisce il pulsante). */
  srLabel?: string;
};

/** Pulsante che esegue una server action e si disattiva mentre lavora. */
export function ActionButton({ action, srLabel, children, variant = "ghost", size = "sm", ...rest }: Props) {
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant={variant} size={size} disabled={pending} className="print:hidden" onClick={() => startTransition(async () => void (await action()))} {...rest}>
      {children}
      {srLabel ? <span className="sr-only">: {srLabel}</span> : null}
    </Button>
  );
}
