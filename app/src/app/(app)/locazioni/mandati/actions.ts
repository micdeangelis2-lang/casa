"use server";

import { createMandate, setMandateArchived } from "@/modules/management";
import { isUuid } from "@/lib/ids";
import { ownerAction, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";

const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");

const PATHS = ["/locazioni/mandati", "/locazioni/calendario", "/locazioni/rendiconto", "/scadenze", "/"];

/** Registra un mandato di gestione (gestore, date, compenso dichiarato come testo, documento) con la scadenza di fine collegata. */
export async function createMandateAction(values: FormValues): Promise<MiniResult> {
  const payload = {
    assetId: text(values, "assetId"),
    managerPartyId: text(values, "managerPartyId"),
    startsOn: text(values, "startsOn"),
    endsOn: text(values, "endsOn"),
    compensation: text(values, "compensation"),
    documentId: text(values, "documentId"),
    note: text(values, "note"),
  };
  return ownerAction((uow) => createMandate(uow, payload), PATHS);
}

export async function archiveMandateAction(mandateId: string): Promise<void> {
  if (isUuid(mandateId)) await ownerAction((uow) => setMandateArchived(uow, mandateId, true), PATHS);
}
