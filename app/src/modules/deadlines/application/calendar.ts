import { buildIcs, type IcsEvent } from "@/shared/ics";
import type { DeadlineCategory, Priority } from "../domain/deadline";
import type { OccurrenceView } from "./ports";

/** Le parole del calendario, gia' tradotte: il modulo non conosce la lingua dell'interfaccia. */
export type CalendarLabels = {
  name: string;
  category: Record<DeadlineCategory, string>;
  priority: Record<Priority, string>;
  fields: { category: string; asset: string; priority: string; proofRequired: string };
  /** Testo dei promemoria; riceve il titolo della scadenza. */
  alarm: (title: string) => string;
};

/** Un evento per ogni scadenza aperta; i preavvisi impostati sulla scadenza diventano promemoria. */
export function calendarEvents(items: OccurrenceView[], labels: CalendarLabels, baseUrl?: string): IcsEvent[] {
  return items
    .filter((o) => o.status === "open" && !o.archived)
    .map((o) => ({
      uid: `${o.id}@gestione-immobili`,
      date: o.dueOn,
      summary: o.title,
      description: [
        `${labels.fields.category}: ${labels.category[o.category]}`,
        o.assetName ? `${labels.fields.asset}: ${o.assetName}` : null,
        o.priority === "high" || o.priority === "urgent" ? `${labels.fields.priority}: ${labels.priority[o.priority]}` : null,
        o.proofRequired ? labels.fields.proofRequired : null,
      ]
        .filter(Boolean)
        .join("\n"),
      url: baseUrl ? `${baseUrl}/scadenze/${o.deadlineId}` : undefined,
      alarmsDaysBefore: o.leadDays,
      alarmText: labels.alarm(o.title),
    }));
}

export function openDeadlinesCalendar(items: OccurrenceView[], labels: CalendarLabels, now: Date, baseUrl?: string): string {
  return buildIcs({ name: labels.name, events: calendarEvents(items, labels, baseUrl), now });
}
