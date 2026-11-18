import { EVENT_TYPE_SUGGESTIONS, type CustomInstrument, type EventPart, type TeamEventType, type TeamPosition } from "@oneverse/core";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { FieldError } from "@oneverse/ui/components/field";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { usePlanning } from "../host";
import { DEFAULT_START, partBody, PartsEditor } from "./team-calendar";

/**
 * A team's event types (issue #523), for its admins: what each asks for and
 * whether its dates get a set. With none yet, the suggestions (a service with
 * its host and music leader; a worship night; a meeting without a set)
 * are a click away.
 */
export function EventTypesDialog({
  teamId,
  types,
  makesSets,
  teamNames,
  positions,
  customInstruments,
  partLabel,
  onChanged,
  onClose,
}: {
  teamId: string;
  types: TeamEventType[];
  /** The team keeps sets: whether a type gets them is asked. */
  makesSets: boolean;
  teamNames: string[];
  positions: readonly TeamPosition[];
  customInstruments: readonly CustomInstrument[];
  partLabel: (part: EventPart) => string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [editing, setEditing] = useState<TeamEventType | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The suggestions the team hasn't added yet (by name), sets-only ones left out for a group that only plans.
  const suggestions = EVENT_TYPE_SUGGESTIONS.filter((one) => makesSets || !one.withSet)
    .map((suggestion) => ({ suggestion, name: t(`teamCalendar.typeSuggestion.${suggestion.key}`) }))
    .filter(({ name }) => !types.some((type) => type.name.toLowerCase() === name.toLowerCase()));

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (editing) {
    return (
      <EventTypeDialog
        teamId={teamId}
        type={editing === "new" ? null : editing}
        makesSets={makesSets}
        teamNames={teamNames}
        positions={positions}
        customInstruments={customInstruments}
        partLabel={partLabel}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await onChanged();
        }}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-testid="event-types-dialog">
        <DialogHeader>
          <DialogTitle>{t("teamCalendar.eventTypes")}</DialogTitle>
          <DialogDescription>{t("teamCalendar.eventTypesDescription")}</DialogDescription>
        </DialogHeader>
        {suggestions.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{types.length === 0 ? t("teamCalendar.eventTypesNone") : t("teamCalendar.eventTypesMore")}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map(({ suggestion, name }) => (
                <Button
                  key={suggestion.key}
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void run(() =>
                      api.createTeamEventType(teamId, {
                        name,
                        startTime: suggestion.startTime,
                        durationMinutes: suggestion.durationMinutes,
                        parts: suggestion.parts,
                        withSet: suggestion.withSet,
                      }),
                    )
                  }
                  data-testid={`event-type-suggest-${suggestion.key}`}
                >
                  <Plus />
                  {t("teamCalendar.eventTypeAdd", { name })}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {types.length > 0 ? (
          <ul className="flex flex-col divide-y" aria-label={t("teamCalendar.eventTypes")}>
            {types.map((type) => (
              <li key={type.id} className="flex items-start gap-2 py-2" data-event-type={type.name}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{type.name}</span>
                    {makesSets && !type.withSet ? <Badge variant="muted" data-testid="event-type-no-set">{t("teamCalendar.eventTypeNoSet")}</Badge> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {type.parts.length > 0 ? type.parts.map((part) => `${partLabel(part)}${part.count > 1 ? ` ×${part.count}` : ""}`).join(", ") : t("teamCalendar.eventTypeNoParts")}
                    {type.eventCount > 0 ? ` · ${t("teamCalendar.eventTypeEvents", { count: type.eventCount })}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t("teamCalendar.eventTypeEdit", { name: type.name })}
                  title={t("teamCalendar.eventTypeEdit", { name: type.name })}
                  onClick={() => setEditing(type)}
                  data-testid="event-type-edit"
                >
                  <Pencil className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => setEditing("new")} data-testid="event-type-new">
            <Plus />
            {t("teamCalendar.eventTypeNew")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("teamCalendar.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A type made or changed: its name, usual timing, parts and whether its dates get a set. */
function EventTypeDialog({
  teamId,
  type,
  makesSets,
  teamNames,
  positions,
  customInstruments,
  partLabel,
  onClose,
  onSaved,
}: {
  teamId: string;
  type: TeamEventType | null;
  makesSets: boolean;
  teamNames: string[];
  positions: readonly TeamPosition[];
  customInstruments: readonly CustomInstrument[];
  partLabel: (part: EventPart) => string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [name, setName] = useState(type?.name ?? "");
  const [startTime, setStartTime] = useState(type?.startTime ?? DEFAULT_START);
  const [duration, setDuration] = useState(String(type?.durationMinutes ?? 90));
  const [call, setCall] = useState(type?.callMinutes ? String(type.callMinutes) : "");
  const [parts, setParts] = useState<EventPart[]>(type?.parts ?? []);
  const [withSet, setWithSet] = useState(type?.withSet ?? true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = { name, startTime: startTime || null, durationMinutes: duration ? Number(duration) : null, callMinutes: call ? Number(call) : null, parts: parts.map(partBody), withSet };
    try {
      if (type) await api.updateTeamEventType(teamId, type.id, body);
      else await api.createTeamEventType(teamId, body);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-testid="event-type-dialog">
        <DialogHeader>
          <DialogTitle>{type ? t("teamCalendar.eventTypeEdit", { name: type.name }) : t("teamCalendar.eventTypeNew")}</DialogTitle>
          {type && type.eventCount > 0 ? <DialogDescription>{t("teamCalendar.eventTypeSavedHint")}</DialogDescription> : null}
        </DialogHeader>
        <form
          id="event-type-form"
          className="grid grid-cols-2 gap-3"
          onSubmit={(submitted) => {
            submitted.preventDefault();
            void save();
          }}
        >
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="event-type-name">{t("teamCalendar.eventTypeName")}</Label>
            <Input id="event-type-name" value={name} maxLength={120} required placeholder={t("teamCalendar.eventTypeNamePlaceholder")} onChange={(e) => setName(e.target.value)} data-testid="event-type-name" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-type-time">{t("teamCalendar.startTime")}</Label>
            <Input id="event-type-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-type-duration">{t("teamCalendar.duration")}</Label>
            <Input id="event-type-duration" type="number" min={5} max={1440} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="event-type-call">{t("teamCalendar.callMinutes")}</Label>
            <Input id="event-type-call" type="number" min={1} max={480} value={call} placeholder="—" onChange={(e) => setCall(e.target.value)} />
          </div>
          {makesSets ? <WithSetField id="event-type-with-set" checked={withSet} onChange={setWithSet} /> : null}
          <PartsEditor parts={parts} onChange={setParts} teamNames={teamNames} positions={positions} customInstruments={customInstruments} partLabel={partLabel} />
        </form>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between">
          {type ? (
            <div className="flex flex-col gap-1">
              <ConfirmButton
                label={t("teamCalendar.eventTypeDelete")}
                confirmLabel={t("teamCalendar.eventTypeConfirmDelete")}
                busyLabel={t("teamCalendar.deleting")}
                cancelLabel={t("teamCalendar.cancel")}
                busy={deleting}
                onConfirm={async () => {
                  setDeleting(true);
                  await api.deleteTeamEventType(teamId, type.id);
                  await onSaved();
                }}
              />
              {type.eventCount > 0 ? <span className="text-xs text-muted-foreground">{t("teamCalendar.eventTypeDeleteHint")}</span> : null}
            </div>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("teamCalendar.cancel")}
            </Button>
            <Button type="submit" form="event-type-form" disabled={busy} data-testid="event-type-save">
              {busy ? t("teamCalendar.saving") : t("teamCalendar.eventTypeSave")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Whether an event's or a type's dates get a set (issue #523). */
export function WithSetField({ id, checked, onChange }: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <div className="col-span-2 flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
        <input id={id} type="checkbox" className="size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={id} />
        {t("teamCalendar.withSet")}
      </label>
      <p className="text-xs text-muted-foreground">{t("teamCalendar.withSetHint")}</p>
    </div>
  );
}
