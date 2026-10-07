import { getTranslations } from "next-intl/server";
import { getDb } from "@/platform/db/client";
import { listDocumentOptions } from "@/modules/documents";
import { MEETING_KINDS, MEETING_STATUSES, type MeetingDetail } from "@/modules/condominium";
import type { FieldSpec, FormValues } from "@/components/simple-form";

export const meetingValues = (m?: Pick<MeetingDetail, "kind" | "status" | "convenedOn" | "meetingOn" | "location" | "convocationDocumentId" | "minutesDocumentId" | "notes">): FormValues => ({
  kind: m?.kind ?? "ordinary",
  status: m?.status ?? "convened",
  convenedOn: m?.convenedOn ?? "",
  meetingOn: m?.meetingOn ?? "",
  location: m?.location ?? "",
  convocationDocumentId: m?.convocationDocumentId ?? "",
  minutesDocumentId: m?.minutesDocumentId ?? "",
  notes: m?.notes ?? "",
});

/** I campi del modulo dell'assemblea: gli stessi per crearla (elenco) e per modificarla (pagina dell'assemblea). */
export async function meetingFields(): Promise<FieldSpec[]> {
  const t = await getTranslations("condominium.meetings");
  const documents = await listDocumentOptions(getDb());
  return [
    { kind: "select", name: "kind", label: t("meetingKind"), options: MEETING_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) })) },
    { kind: "select", name: "status", label: t("meetingStatus"), options: MEETING_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })) },
    { kind: "date", name: "convenedOn", label: t("convenedOn") },
    { kind: "date", name: "meetingOn", label: t("meetingOn") },
    { kind: "text", name: "location", label: t("location"), maxLength: 200 },
    { kind: "select", name: "convocationDocumentId", label: t("convocation"), options: documents, emptyLabel: t("noDocument") },
    { kind: "select", name: "minutesDocumentId", label: t("minutes"), options: documents, emptyLabel: t("noDocument") },
    { kind: "text", name: "notes", label: t("notes"), maxLength: 2000 },
  ];
}
