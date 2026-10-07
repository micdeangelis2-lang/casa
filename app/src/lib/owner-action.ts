import "server-only";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork, type UnitOfWork } from "@/platform/db/unit-of-work";
import type { FieldErrors, Result } from "@/shared/result";

/** Esito di un'azione piccola (aggiungere una voce a un elenco): errori da mostrare, oppure niente. */
export type MiniResult = { errors?: FieldErrors };

/**
 * Esegue un caso d'uso come proprietario, in una transazione con audit, e ricarica le pagine indicate.
 * Ogni azione passa da qui: la sessione si verifica sempre sul server (`requireOwner`).
 */
export async function ownerAction<T>(work: (uow: UnitOfWork) => Promise<Result<T>>, paths: string[]): Promise<MiniResult> {
  const owner = await requireOwner();
  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, work);
  for (const path of paths) revalidatePath(path);
  return result.ok ? {} : { errors: result.errors };
}

/** Come `ownerAction`, restituendo anche il valore. */
export async function ownerActionWithValue<T>(work: (uow: UnitOfWork) => Promise<Result<T>>, paths: string[]): Promise<Result<T>> {
  const owner = await requireOwner();
  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, work);
  for (const path of paths) revalidatePath(path);
  return result;
}
