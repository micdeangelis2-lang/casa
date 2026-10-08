"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { ASSET_KINDS, RIGHT_TYPES, USE_TYPES } from "@/modules/assets";
import { DEADLINE_CATEGORIES, LEVELS, PRIORITIES } from "@/modules/deadlines";
import { PARTY_ROLES } from "@/modules/directory";
import {
  CSV_LIMITS,
  isImportKind,
  previewImport,
  runImport,
  type ImportCounts,
  type ImportKind,
  type ImportLabels,
  type ImportPreview,
} from "@/modules/import";

export type ImportActionResult =
  | { phase: "preview"; kind: ImportKind; preview: ImportPreview }
  | { phase: "done"; kind: ImportKind; counts: ImportCounts }
  | { phase: "error"; message: string };

const REVALIDATE: Record<ImportKind, string> = {
  contacts: "/rubrica",
  assets: "/immobili",
  deadlines: "/scadenze",
  rents: "/locazioni",
  taxes: "/tributi",
  taxPayments: "/tributi",
  policies: "/assicurazioni",
};

const ACCEPTED_TYPES = new Set(["", "text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"]);

/** UTF-8 (con o senza BOM); se non lo e', il file e' quasi certamente ANSI di Excel: windows-1252. */
function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

async function buildLabels(): Promise<ImportLabels> {
  const [role, assets, deadlines, rules] = await Promise.all([getTranslations("directory.role"), getTranslations("assets"), getTranslations("deadlines"), getTranslations("rules.level")]);
  return {
    roles: Object.fromEntries(PARTY_ROLES.map((c) => [c, role(c)])),
    kinds: Object.fromEntries(ASSET_KINDS.map((c) => [c, assets(`kind.${c}`)])),
    uses: Object.fromEntries(USE_TYPES.map((c) => [c, assets(`use.${c}`)])),
    rights: Object.fromEntries(RIGHT_TYPES.map((c) => [c, assets(`right.${c}`)])),
    categories: Object.fromEntries(DEADLINE_CATEGORIES.map((c) => [c, deadlines(`category.${c}`)])),
    levels: Object.fromEntries(LEVELS.map((c) => [c, rules(c)])),
    priorities: Object.fromEntries(PRIORITIES.map((c) => [c, deadlines(`priority.${c}`)])),
  };
}

/**
 * Anteprima (`mode=preview`, nessuna scrittura) e importazione (`mode=import`, una sola transazione) dello stesso file.
 * Il file non viene conservato: per importare il browser lo invia di nuovo e il server lo ricontrolla.
 */
export async function importAction(data: FormData): Promise<ImportActionResult> {
  const owner = await requireOwner();
  const t = await getTranslations("import");
  const kind = data.get("kind");
  const file = data.get("file");
  const mode = data.get("mode");
  if (!isImportKind(kind)) return { phase: "error", message: t("errors.kind") };
  if (!(file instanceof File) || file.size === 0) return { phase: "error", message: t("errors.noFile") };
  if (file.size > CSV_LIMITS.maxChars) return { phase: "error", message: t("errors.tooBig") };
  if (!/\.(csv|txt)$/i.test(file.name) || !ACCEPTED_TYPES.has(file.type)) return { phase: "error", message: t("errors.notCsv") };

  const text = decode(new Uint8Array(await file.arrayBuffer()));
  const labels = await buildLabels();
  const db = getDb();

  if (mode === "import") {
    const result = await runImport(db, { type: "owner", id: owner.userId }, { displayName: owner.name, email: owner.email }, kind, text, labels);
    if (!result.ok) return { phase: "error", message: result.message };
    revalidatePath(REVALIDATE[kind]);
    return { phase: "done", kind, counts: result.counts };
  }
  const preview = await previewImport(db, kind, text, labels);
  if (!preview.ok) return { phase: "error", message: preview.message };
  return { phase: "preview", kind, preview };
}
