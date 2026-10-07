import { getTranslations } from "next-intl/server";
import { DELIVERY_KINDS, type ReviewLabels } from "@/modules/condominium";

/** Etichette per i CSV delle viste di controllo del condominio (stessi testi della pagina). */
export async function condominiumReviewLabels(): Promise<ReviewLabels> {
  const t = await getTranslations("condominioAdmin");
  return {
    kinds: { ordinary: t("kinds.ordinary"), extraordinary: t("kinds.extraordinary"), final: t("kinds.final") },
    meetingKinds: { ordinary: t("meetingKinds.ordinary"), extraordinary: t("meetingKinds.extraordinary") },
    outcomes: { not_recorded: t("outcomes.not_recorded"), approved: t("outcomes.approved"), rejected: t("outcomes.rejected"), postponed: t("outcomes.postponed") },
    deliveries: Object.fromEntries(DELIVERY_KINDS.map((k) => [k, t(`consegne.short.${k}`)])),
  };
}
