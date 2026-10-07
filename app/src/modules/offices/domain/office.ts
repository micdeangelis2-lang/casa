/**
 * Vista «cosa e' aperto presso un ufficio» (funzioni pure). Un ufficio e' un contatto della rubrica con ruolo
 * «ufficio pubblico». Cio' che lo riguarda e' gia' nei moduli Pratiche e Scadenze: qui si raggruppa soltanto.
 * Nessuna valutazione: si elencano date e stati inseriti dal proprietario.
 */
export type OfficeMatterInput = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "waiting" | "closed";
  openedOn: string;
  closedOn: string | null;
  assetName: string | null;
  assignments: { partyId: string; role: string | null }[];
  requests: { id: string; title: string; requestedFromPartyId: string | null; status: "requested" | "received" | "not_available"; requestedOn: string; dueOn: string | null; documentTitle: string | null }[];
  opinions: { id: string; partyId: string; nature: "informational" | "formally_validated"; summary: string; issuedOn: string | null; documentTitle: string | null }[];
  /** Ufficio destinatario registrato sulla pratica, con protocollo, data di presentazione e termine di risposta comunicato. */
  officePartyId?: string | null;
  protocolNumber?: string | null;
  submittedOn?: string | null;
  responseDueOn?: string | null;
};

export type OfficeDeadlineInput = {
  deadlineId: string;
  occurrenceId: string;
  title: string;
  dueOn: string;
  assetName: string | null;
  responsiblePartyId: string | null;
  professionalPartyId: string | null;
  /** Pratica collegata alla scadenza (se c'e'). */
  matterId?: string | null;
};

export type OfficeMatter = {
  id: string;
  title: string;
  status: OfficeMatterInput["status"];
  openedOn: string;
  closedOn: string | null;
  assetName: string | null;
  role: string | null;
  requests: OfficeMatterInput["requests"];
  opinions: OfficeMatterInput["opinions"];
  /** La pratica indica questo ufficio come destinatario. */
  isRecipient: boolean;
  protocolNumber: string | null;
  submittedOn: string | null;
  responseDueOn: string | null;
};

export type OfficeDeadline = { deadlineId: string; occurrenceId: string; title: string; dueOn: string; assetName: string | null; overdue: boolean };

export type OfficeCounts = { openMatters: number; openRequests: number; openDeadlines: number; overdue: number; nextDueOn: string | null; answers: number };

export type OfficeView = { matters: OfficeMatter[]; deadlines: OfficeDeadline[]; counts: OfficeCounts };

const isOpenMatter = (m: { status: string }) => m.status !== "closed";

/** Tutto cio' che nei dati risulta legato all'ufficio: pratiche in cui e' incaricato o da cui sono state chieste carte o registrati pareri, e scadenze con l'ufficio come responsabile o referente. */
export function buildOfficeView(partyId: string, matters: readonly OfficeMatterInput[], deadlines: readonly OfficeDeadlineInput[], today: string): OfficeView {
  const mine: OfficeMatter[] = [];
  for (const m of matters) {
    const assignment = m.assignments.find((a) => a.partyId === partyId);
    const requests = m.requests.filter((r) => r.requestedFromPartyId === partyId);
    const opinions = m.opinions.filter((o) => o.partyId === partyId);
    const isRecipient = m.officePartyId === partyId;
    if (!assignment && requests.length === 0 && opinions.length === 0 && !isRecipient) continue;
    mine.push({
      id: m.id,
      title: m.title,
      status: m.status,
      openedOn: m.openedOn,
      closedOn: m.closedOn,
      assetName: m.assetName,
      role: assignment?.role ?? null,
      requests,
      opinions,
      isRecipient,
      protocolNumber: isRecipient ? (m.protocolNumber ?? null) : null,
      submittedOn: isRecipient ? (m.submittedOn ?? null) : null,
      responseDueOn: isRecipient ? (m.responseDueOn ?? null) : null,
    });
  }
  // Prima le pratiche aperte, dalla piu' vecchia; poi le chiuse, dalla piu' recente.
  mine.sort((a, b) => Number(!isOpenMatter(a)) - Number(!isOpenMatter(b)) || (isOpenMatter(a) ? a.openedOn.localeCompare(b.openedOn) : b.openedOn.localeCompare(a.openedOn)));

  const recipientMatterIds = new Set(mine.filter((m) => m.isRecipient).map((m) => m.id));
  const due = deadlines
    .filter((d) => d.responsiblePartyId === partyId || d.professionalPartyId === partyId || (d.matterId != null && recipientMatterIds.has(d.matterId)))
    .map((d) => ({ deadlineId: d.deadlineId, occurrenceId: d.occurrenceId, title: d.title, dueOn: d.dueOn, assetName: d.assetName, overdue: d.dueOn < today }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  const openMatters = mine.filter(isOpenMatter);
  const openRequests = openMatters.flatMap((m) => m.requests.filter((r) => r.status === "requested"));
  const responseDates = openMatters.flatMap((m) => (m.responseDueOn ? [m.responseDueOn] : []));
  const dates = [...openRequests.flatMap((r) => (r.dueOn ? [r.dueOn] : [])), ...responseDates, ...due.map((d) => d.dueOn)].sort();
  return {
    matters: mine,
    deadlines: due,
    counts: {
      openMatters: openMatters.length,
      openRequests: openRequests.length,
      openDeadlines: due.length,
      overdue: due.filter((d) => d.overdue).length + openRequests.filter((r) => r.dueOn && r.dueOn < today).length + responseDates.filter((d) => d < today).length,
      nextDueOn: dates[0] ?? null,
      answers: mine.reduce((n, m) => n + m.opinions.length + m.requests.filter((r) => r.status !== "requested").length, 0),
    },
  };
}
