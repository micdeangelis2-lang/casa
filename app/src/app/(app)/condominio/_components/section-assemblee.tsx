import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CondominiumDetail } from "@/modules/condominium";
import { InlineForm } from "@/components/inline-form";
import { formatDate } from "@/lib/format";
import { createMeetingAction } from "../actions";
import { meetingFields, meetingValues } from "./meeting-form-data";

export async function AssembleeSection({ condo }: { condo: CondominiumDetail }) {
  const t = await getTranslations("condominium.meetings");
  const meetings = [...condo.meetings].sort((a, b) => b.meetingOn.localeCompare(a.meetingOn));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {meetings.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="meeting-list">
            {meetings.map((m) => (
              <li key={m.id}>
                <Link href={`/condominio/${condo.id}/assemblee/${m.id}`} className="flex flex-wrap items-center gap-2 py-3 hover:bg-accent/50 focus-visible:bg-accent/50">
                  <span className="font-medium">{t("onDate", { kind: t(`kind.${m.kind}`).toLowerCase(), date: formatDate(m.meetingOn) })}</span>
                  <Badge variant={m.status === "convened" ? "secondary" : "outline"}>{t(`status.${m.status}`)}</Badge>
                  {m.location ? <span className="text-sm text-muted-foreground">{m.location}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <InlineForm idPrefix="meeting" title={t("addHeading")} fields={await meetingFields()} initial={meetingValues()} submitLabel={t("add")} onSubmit={createMeetingAction.bind(null, condo.id)} />
    </div>
  );
}
