import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { listParties, type Party } from "@/modules/directory";
import { getDocumentDetail } from "@/modules/documents";
import { TIMELINE_KINDS, buildChecklist, buildTimeline, getMatterDetail, type ChecklistItem, type MatterDetail, type Timeline, type TimelineCsvLabels, type TimelineEvent } from "@/modules/matters";
import { getClaimDetail, listClaims } from "@/modules/insurance";
import { getCondominiumDetail, listCondominiums } from "@/modules/condominium";
import { listDeadlines, listOccurrences } from "@/modules/deadlines";
import { getLettingDetail, listLettings } from "@/modules/lettings";

/**
 * Fascicolo di una pratica per il professionista: mette insieme, SOLO in lettura, cio' che le altre aree dell'app hanno
 * registrato su quella pratica (sinistri e controversie collegati, scadenze che indicano un incaricato come professionista,
 * canoni dell'immobile). Dice cosa risulta dai dati; non valuta ragioni, termini di legge ne' esiti.
 */

/** Traduttore dello spazio dei nomi `avvocato` (chiavi libere: i test lo sostituiscono con un finto). */
export type DossierT = (key: string, values?: Record<string, string | number>) => string;

export type DossierDocument = { id: string; title: string; categoryName: string; confidentiality: string; issuedOn: string | null; issuerName: string | null; validTo: string | null; verificationStatus: string; fileName: string; sha256: string };
export type DossierParty = Pick<Party, "id" | "displayName" | "email" | "pec" | "phone" | "address" | "taxCode"> & { role: string | null; roles: string[] };
export type DossierRent = { lettingTitle: string; dueOn: string; amountCents: number; paidCents: number; residualCents: number };

export type MatterDossier = {
  matter: MatterDetail;
  today: string;
  parties: DossierParty[];
  documents: DossierDocument[];
  timeline: Timeline;
  checklist: ChecklistItem[];
  rents: DossierRent[];
  /** Importi registrati nelle fonti collegate (sinistri), in centesimi. */
  claimTotals: { claimedCents: number; receivedCents: number } | null;
};

const CONDO_KINDS = ["claim", "dispute", "report", "communication"];

export async function loadMatterDossier(db: Db, id: string, t: DossierT, today = todayInItaly()): Promise<MatterDossier | null> {
  const matter = await getMatterDetail(db, id);
  if (!matter) return null;
  const events: TimelineEvent[] = [];
  const push = (e: Partial<TimelineEvent> & Pick<TimelineEvent, "date" | "kind" | "title">) => events.push({ detail: null, href: null, amountCents: null, ...e });
  const href = `/pratiche/${id}`;

  // Parti: i dati di contatto stanno in rubrica.
  const directory = new Map((await listParties(db, { includeArchived: true })).map((p) => [p.id, p]));
  const parties: DossierParty[] = matter.assignments.map((a) => {
    const p = directory.get(a.partyId);
    return { id: a.partyId, displayName: a.name, email: p?.email ?? null, pec: p?.pec ?? null, phone: p?.phone ?? null, address: p?.address ?? null, taxCode: p?.taxCode ?? null, role: a.role, roles: a.roles };
  });
  const partyIds = new Set(parties.map((p) => p.id));

  // Documenti collegati: con data, emittente, validita' e impronta.
  const documents: DossierDocument[] = [];
  for (const d of matter.documents) {
    const detail = await getDocumentDetail(db, d.id);
    const v = detail?.versions[0];
    if (!detail || !v) continue;
    documents.push({ id: d.id, title: detail.title, categoryName: detail.categoryName, confidentiality: detail.confidentiality, issuedOn: v.issuedOn, issuerName: v.issuerName, validTo: v.validTo, verificationStatus: v.verificationStatus, fileName: v.originalFilename, sha256: v.sha256 });
  }
  for (const d of documents) {
    if (d.issuedOn) push({ date: d.issuedOn, kind: "document", title: t("event.document", { title: d.title }), detail: d.issuerName ? t("event.issuer", { name: d.issuerName }) : null, href: `/documenti/${d.id}` });
  }

  push({ date: matter.openedOn, kind: "matter", title: t("event.opened"), detail: matter.title, href });
  if (matter.submittedOn) {
    push({
      date: matter.submittedOn,
      kind: "submission",
      title: matter.officeName ? t("event.submitted", { name: matter.officeName }) : t("event.submittedNoOffice"),
      detail: matter.protocolNumber ? t("event.protocol", { number: matter.protocolNumber }) : null,
      href,
    });
  }
  if (matter.responseDueOn) push({ date: matter.responseDueOn, kind: "submission", title: t("event.responseDue"), detail: matter.officeName, href });
  for (const e of matter.events) {
    push({
      date: e.occurredOn,
      kind: "event",
      title: t("event.matterEvent", { kind: t(`eventKind.${e.kind}`), title: e.title }),
      detail: [e.partyName ? t("event.eventParty", { name: e.partyName }) : null, e.note, e.documentTitle].filter(Boolean).join(" · ") || null,
      href,
    });
  }
  if (matter.closedOn) push({ date: matter.closedOn, kind: "matter", title: t("event.closed"), href });
  for (const r of matter.requests) {
    push({ date: r.requestedOn, kind: "request", title: t("event.request", { title: r.title }), detail: [r.requestedFromName ? t("event.requestFrom", { name: r.requestedFromName }) : null, t(`requestStatus.${r.status}`), r.note].filter(Boolean).join(" · "), href });
    if (r.dueOn) push({ date: r.dueOn, kind: "request", title: t("event.requestDue", { title: r.title }), detail: t(`requestStatus.${r.status}`), href });
  }
  for (const o of matter.opinions) {
    push({ date: o.issuedOn, kind: "opinion", title: t("event.opinion", { name: o.partyName, nature: t(`nature.${o.nature}`) }), detail: o.summary, href });
  }

  // Sinistri collegati (assicurazioni): fatti, comunicazioni e importi.
  let claimedSum = 0;
  let receivedSum = 0;
  let hasAmounts = false;
  for (const c of (await listClaims(db, { includeClosed: true })).filter((x) => x.matterId === id)) {
    const claim = await getClaimDetail(db, c.id);
    if (!claim) continue;
    const link = `/assicurazioni/sinistri/${claim.id}`;
    const amounts = [claim.claimedCents !== null ? t("event.claimed", { amount: money(claim.claimedCents) }) : null, claim.receivedCents !== null ? t("event.received", { amount: money(claim.receivedCents) }) : null].filter(Boolean).join(" · ");
    if (claim.claimedCents !== null || claim.receivedCents !== null) {
      hasAmounts = true;
      claimedSum += claim.claimedCents ?? 0;
      receivedSum += claim.receivedCents ?? 0;
    }
    push({ date: claim.occurredOn, kind: "claim", title: t("event.claim", { title: claim.title }), detail: [claim.claimNumber ? t("event.claimNumber", { number: claim.claimNumber }) : null, amounts || null].filter(Boolean).join(" · ") || null, href: link, amountCents: claim.claimedCents });
    if (claim.reportedOn) push({ date: claim.reportedOn, kind: "claim", title: t("event.claimReported", { title: claim.title }), href: link });
    if (claim.closedOn) push({ date: claim.closedOn, kind: "claim", title: t("event.claimClosed", { title: claim.title }), href: link });
    for (const e of claim.entries) {
      push({ date: e.entryOn, kind: "communication", title: t(`event.entry.${e.direction}`), detail: [e.summary, e.documentTitle].filter(Boolean).join(" · "), href: link });
    }
  }

  // Segnalazioni e controversie del condominio collegate alla pratica.
  for (const row of await listCondominiums(db, true)) {
    const condo = await getCondominiumDetail(db, row.id);
    for (const c of condo?.claims.filter((x) => x.matterId === id) ?? []) {
      const kind = CONDO_KINDS.includes(c.kind) ? c.kind : "claim";
      const link = `/condominio/${row.id}`;
      push({ date: c.openedOn, kind: "claim", title: t("event.condoClaim", { kind: t(`condoKind.${kind}`), title: c.title }), detail: [condo?.name, c.description].filter(Boolean).join(" · "), href: link });
      if (c.closedOn) push({ date: c.closedOn, kind: "claim", title: t("event.condoClaimClosed", { title: c.title }), href: link });
    }
  }

  // Scadenze collegate alla pratica; in via di ripiego (dati inseriti prima del collegamento) quelle SENZA pratica che
  // indicano come professionista uno degli incaricati.
  const related = (await listDeadlines(db, {})).filter((d) => d.matterId === id || (d.matterId === null && d.professionalPartyId !== null && partyIds.has(d.professionalPartyId)));
  const relatedIds = new Set(related.map((d) => d.id));
  const occurrences = relatedIds.size === 0 ? [] : (await listOccurrences(db, "all", {}, today)).filter((o) => relatedIds.has(o.deadlineId));
  for (const o of occurrences) {
    const state = o.status === "done" ? t("deadlineState.done", { date: o.completedOn ? dateIt(o.completedOn) : "—" }) : o.status === "cancelled" ? t("deadlineState.cancelled") : t("deadlineState.open");
    push({ date: o.dueOn, kind: "deadline", title: t("event.deadline", { title: o.title }), detail: state, href: `/scadenze/${o.deadlineId}` });
  }

  // Canoni dell'immobile della pratica con importo pagato inferiore a quello indicato.
  const rents: DossierRent[] = [];
  if (matter.assetId) {
    for (const l of await listLettings(db, { assetId: matter.assetId, includeEnded: true }, today)) {
      const detail = await getLettingDetail(db, l.id, today);
      for (const r of detail?.rents ?? []) {
        if (r.paidCents >= r.amountCents) continue;
        const residualCents = r.amountCents - r.paidCents;
        rents.push({ lettingTitle: l.title, dueOn: r.dueOn, amountCents: r.amountCents, paidCents: r.paidCents, residualCents });
        push({ date: r.dueOn, kind: "rent", title: t("event.rent", { title: l.title }), detail: t("event.rentDetail", { amount: money(r.amountCents), paid: money(r.paidCents) }), href: `/locazioni/${l.id}`, amountCents: residualCents });
      }
    }
  }

  const checklist = buildChecklist({
    today,
    partyCount: parties.length,
    hasLawyerRole: parties.some((p) => p.roles.includes("lawyer")),
    hasAsset: matter.assetId !== null,
    hasDescription: Boolean(matter.description),
    documents,
    requests: matter.requests,
    opinions: matter.opinions,
    deadlineCount: occurrences.length,
  });
  const claimTotals = hasAmounts ? { claimedCents: claimedSum, receivedCents: receivedSum } : null;
  return { matter, today, parties, documents, timeline: buildTimeline(events), checklist, rents, claimTotals };
}

const money = (cents: number): string => (cents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
const dateIt = (value: string): string => value.split("-").reverse().join("/");

/** Etichette del CSV della cronologia, dallo spazio dei nomi `avvocato`. */
export const csvLabels = (t: DossierT): TimelineCsvLabels => ({
  header: [t("csvHeader.date"), t("csvHeader.source"), t("csvHeader.fact"), t("csvHeader.detail"), t("csvHeader.amount")],
  kind: Object.fromEntries(TIMELINE_KINDS.map((k) => [k, t(`kind.${k}`)])) as TimelineCsvLabels["kind"],
});
