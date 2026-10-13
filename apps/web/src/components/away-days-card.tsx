import type { AwayDays } from "@songverse/core";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Calendar } from "@songverse/ui/components/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { calendarLocale, fromDayKey, toDayKey } from "@songverse/ui/lib/dates";
import { formatSetDate } from "#/lib/setlists";

type Range = { from: string; to: string; note: string | null };

/**
 * The days one is away, for all one's teams (issue #235): each range shown,
 * edited or removed; added or edited on a range calendar (the first day,
 * then the last), the other ranges shaded, with a note.
 */
export function AwayDaysCard({ away, onAdd, onUpdate, onRemove }: { away: AwayDays[]; onAdd: (range: Range) => Promise<void>; onUpdate: (id: string, range: Range) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  // The range being added ("new") or edited (its ID); null: none.
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Card data-testid="away-card">
      <CardHeader>
        <CardTitle className="text-sm">{t("teamCalendar.awayTitle")}</CardTitle>
        <CardDescription>{t("teamCalendar.awayDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {away.length === 0 && editing !== "new" ? <p className="text-sm text-muted-foreground">{t("teamCalendar.noAway")}</p> : null}
        {away.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {away.map((range) =>
              editing === range.id ? (
                <li key={range.id} className="py-2 first:pt-0">
                  <AwayEditor
                    initial={range}
                    others={away.filter((other) => other.id !== range.id)}
                    onCancel={() => setEditing(null)}
                    onSave={async (next) => {
                      await onUpdate(range.id, next);
                      setEditing(null);
                    }}
                  />
                </li>
              ) : (
                <li key={range.id} className="flex items-center justify-between gap-2 py-2 first:pt-0" data-away-range={`${range.from}/${range.to}`}>
                  <div className="min-w-0 text-sm">
                    <div>{range.from === range.to ? formatSetDate(range.from, i18n.language) : `${formatSetDate(range.from, i18n.language)} – ${formatSetDate(range.to, i18n.language)}`}</div>
                    {range.note ? <div className="truncate text-xs text-muted-foreground">{range.note}</div> : null}
                  </div>
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon" className="size-8" aria-label={t("teamCalendar.awayEdit")} title={t("teamCalendar.awayEdit")} disabled={editing !== null} onClick={() => setEditing(range.id)} data-testid="away-edit">
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" aria-label={t("teamCalendar.removeAway")} title={t("teamCalendar.removeAway")} disabled={editing !== null} onClick={() => void onRemove(range.id)} data-testid="away-remove">
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : null}
        {editing === "new" ? (
          <AwayEditor
            initial={null}
            others={away}
            onCancel={() => setEditing(null)}
            onSave={async (range) => {
              await onAdd(range);
              setEditing(null);
            }}
          />
        ) : editing === null ? (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setEditing("new")} data-testid="away-add-open">
            <Plus />
            {t("teamCalendar.awayAddButton")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A range on the calendar, its note, saved or not. New ranges start from today. */
function AwayEditor({ initial, others, onCancel, onSave }: { initial: Range | null; others: AwayDays[]; onCancel: () => void; onSave: (range: Range) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<DateRange | undefined>(initial ? { from: fromDayKey(initial.from), to: fromDayKey(initial.to) } : undefined);
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = selected?.from ? toDayKey(selected.from) : null;
  const to = selected?.to ? toDayKey(selected.to) : from;

  return (
    <form
      className="flex flex-col gap-3 rounded-md border p-3"
      data-testid="away-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!from || !to) return;
        setBusy(true);
        void onSave({ from, to, note: note.trim() || null }).finally(() => setBusy(false));
      }}
    >
      <p className="text-xs text-muted-foreground">{t("teamCalendar.awayPick")}</p>
      <Calendar
        mode="range"
        selected={selected}
        onSelect={setSelected}
        locale={calendarLocale(i18n.language)}
        defaultMonth={selected?.from ?? today}
        // A new range can't start in the past; one already there keeps its days.
        disabled={initial ? undefined : { before: today }}
        // The other ranges: one muted strip each, rounded at its ends, days struck through.
        modifiers={{
          otherAway: others.map((range) => ({ from: fromDayKey(range.from), to: fromDayKey(range.to) })),
          otherAwayStart: others.map((range) => fromDayKey(range.from)),
          otherAwayEnd: others.map((range) => fromDayKey(range.to)),
        }}
        modifiersClassNames={{ otherAway: "bg-muted text-muted-foreground [&>button]:line-through", otherAwayStart: "rounded-l-md", otherAwayEnd: "rounded-r-md" }}
        className="self-center rounded-md border p-2"
      />
      <div className="text-sm font-medium" data-testid="away-selected">
        {from ? (from === to ? formatSetDate(from, i18n.language) : `${formatSetDate(from, i18n.language)} – ${formatSetDate(to!, i18n.language)}`) : "—"}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="away-note">{t("teamCalendar.awayNote")}</Label>
        <Input id="away-note" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!from || busy} data-testid="away-save">
          {initial ? t("teamCalendar.awaySave") : t("teamCalendar.addAway")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("teamCalendar.cancel")}
        </Button>
      </div>
    </form>
  );
}
