import type { EventLocation, LocationRoom } from "@oneverse/core";
import { DoorOpen, House, MapPin, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { usePlanning } from "../host";
import { ApprovalFields, BookingsButton, useManagerTeams } from "./bookings";
import { FieldError } from "@oneverse/ui/components/field";

type Owner = { teamId: string } | { organizationId: string };

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const allZones = (current: string) => {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [current];
  return zones.includes(current) ? zones : [current, ...zones];
};

/** The locations an event can take (issue #320): a team's own and its organisation's, or an organisation's. */
export function useLocations(owner: Owner | null) {
  const { api } = usePlanning();
  const [locations, setLocations] = useState<EventLocation[]>([]);
  const key = JSON.stringify(owner);
  useEffect(() => {
    if (!owner) return;
    let live = true;
    api
      .listLocations(owner)
      .then((list) => live && setLocations(list))
      .catch(() => live && setLocations([]));
    return () => {
      live = false;
    };
  }, [key]);
  return locations;
}

/**
 * An event's venue (issue #320), shown when its owner has any. Picking one
 * fills the place (unless one of its own was typed) and the time zone; a
 * venue with rooms (issue #563) then asks which it takes - none on another
 * venue.
 */
export function LocationField({
  id,
  locations,
  value,
  place,
  onChange,
  rooms,
  onRooms,
}: {
  id: string;
  locations: EventLocation[];
  value: string;
  place: string;
  onChange: (change: { locationId: string; place?: string; timeZone?: string }) => void;
  rooms?: string[];
  onRooms?: (roomIds: string[]) => void;
}) {
  const { t } = useTranslation();
  if (locations.length === 0 && !value) return null;
  const current = locations.find((one) => one.id === value);
  return (
    <div className="col-span-2 flex flex-col gap-1.5">
      <Label htmlFor={id}>{t("teamCalendar.location")}</Label>
      <NativeSelect
        id={id}
        value={value}
        data-testid="event-location"
        onChange={(e) => {
          const picked = locations.find((one) => one.id === e.target.value);
          // The place follows the location while it's empty or the last location's name.
          const follows = !place || place === current?.name;
          onChange({ locationId: e.target.value, ...(picked ? { timeZone: picked.timeZone, ...(follows ? { place: picked.name } : {}) } : {}) });
          onRooms?.([]);
        }}
      >
        <option value="">{t("teamCalendar.noLocation")}</option>
        {locations.map((one) => (
          <option key={one.id} value={one.id}>
            {one.name}
          </option>
        ))}
      </NativeSelect>
      {onRooms && current?.rooms?.length ? (
        <fieldset className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5" data-testid="event-rooms">
          <legend className="sr-only">{t("locations.rooms")}</legend>
          {current.rooms.map((room) => {
            const checked = rooms?.includes(room.id) ?? false;
            return (
              <label key={room.id} className="flex items-center gap-2 text-sm" data-testid="event-room" data-room={room.name}>
                <input type="checkbox" className="size-4" checked={checked} onChange={(e) => onRooms(e.target.checked ? [...(rooms ?? []), room.id] : (rooms ?? []).filter((one) => one !== room.id))} />
                {room.name}
              </label>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}

/**
 * A team's or an organisation's locations (issue #320), on its page for its
 * admins: each with its address and time zone, added, edited or removed.
 */
export function LocationsCard({ owner }: { owner: Owner }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [locations, setLocations] = useState<EventLocation[]>([]);
  // The location being edited (its ID), "new", or null.
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ownerId = "teamId" in owner ? owner.teamId : owner.organizationId;
  const key = JSON.stringify(owner);

  // Its own only: a team's list also holds its organisation's.
  const load = async () => setLocations((await api.listLocations(owner)).filter((one) => one.owner.id === ownerId));
  useEffect(() => {
    void load().catch(() => setLocations([]));
  }, [key]);

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await action();
      await load();
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card data-testid="locations-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MapPin className="size-4 text-muted-foreground" aria-hidden />
          {t("locations.title")}
        </CardTitle>
        <CardDescription>{t("locations.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {locations.length === 0 && editing !== "new" ? <p className="text-sm text-muted-foreground">{t("locations.empty")}</p> : null}
        {locations.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {locations.map((location) =>
              editing === location.id ? (
                <li key={location.id} className="py-2 first:pt-0">
                  <LocationEditor
                    initial={location}
                    busy={busy === location.id}
                    onCancel={() => setEditing(null)}
                    onSave={(data) => run(location.id, () => api.updateLocation(location.id, { ...data, address: data.address || null }))}
                  />
                </li>
              ) : (
                <li key={location.id} className="flex items-start justify-between gap-2 py-2 first:pt-0" data-testid="location-row">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {location.home ? <House className="size-3.5 text-muted-foreground" aria-label={t("locations.home")} /> : null}
                      {location.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{[location.address, location.timeZone.replaceAll("_", " ")].filter(Boolean).join(" · ")}</p>
                    <Rooms location={location} owner={owner} onChanged={load} onError={setError} />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {location.rooms?.length ? <BookingsButton title={location.name} load={(from, to) => api.locationBookings(location.id, from, to)} /> : null}
                    <Button variant="ghost" size="sm" onClick={() => setEditing(location.id)}>
                      {t("locations.edit")}
                    </Button>
                    <ConfirmButton
                      label={t("locations.remove")}
                      confirmLabel={t("locations.remove")}
                      busyLabel={t("locations.remove")}
                      cancelLabel={t("locations.cancel")}
                      busy={busy === location.id}
                      onConfirm={() => run(location.id, () => api.deleteLocation(location.id))}
                    />
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : null}
        {editing === "new" ? (
          <LocationEditor busy={busy === "new"} onCancel={() => setEditing(null)} onSave={(data) => run("new", () => api.createLocation({ ...data, address: data.address || undefined, ...owner }))} />
        ) : (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setEditing("new")} data-testid="location-add">
            {t("locations.add")}
          </Button>
        )}
        {error ? <FieldError>{error}</FieldError> : null}
      </CardContent>
    </Card>
  );
}

/** A venue's rooms (issue #563): each with its capacity, setup and teardown times and approval (issue #565), changed by clicking it, removed with ×; a new one by name. */
function Rooms({ location, owner, onChanged, onError }: { location: EventLocation; owner: Owner; onChanged: () => Promise<unknown>; onError: (message: string) => void }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const managerTeams = useManagerTeams(owner);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
      setEditing(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const rooms: LocationRoom[] = location.rooms ?? [];
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="location-rooms">
      {rooms.map((room) =>
        editing === room.id ? (
          <RoomForm key={room.id} initial={room} teams={managerTeams} busy={busy} onCancel={() => setEditing(null)} onSave={(data) => void run(() => api.updateRoom(location.id, room.id, { ...data, capacity: data.capacity ?? null, managerTeamId: data.managerTeamId ?? null }))} />
        ) : (
          <span key={room.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs" data-testid="location-room" data-room={room.name}>
            <DoorOpen className="size-3 text-muted-foreground" aria-hidden />
            {location.canEdit ? (
              <button type="button" className="hover:underline" aria-label={t("locations.editRoom", { name: room.name })} onClick={() => setEditing(room.id)}>
                {room.name}
              </button>
            ) : (
              room.name
            )}
            {room.capacity ? <span className="text-muted-foreground">· {t("locations.capacityOf", { count: room.capacity })}</span> : null}
            {room.setupMinutes ? <span className="text-muted-foreground">· {t("locations.setupOf", { count: room.setupMinutes })}</span> : null}
            {room.teardownMinutes ? <span className="text-muted-foreground">· {t("locations.teardownOf", { count: room.teardownMinutes })}</span> : null}
            {room.needsApproval ? (
              <span className="inline-flex items-center gap-0.5 text-muted-foreground" data-testid="room-approval">
                · <ShieldCheck className="size-3" aria-hidden />
                {room.managerTeam ? t("bookings.teamAdmins", { team: room.managerTeam.name }) : t("bookings.itsAdmins")}
              </span>
            ) : null}
            {location.canEdit ? (
              <button type="button" className="ml-0.5 text-muted-foreground hover:text-destructive" aria-label={t("locations.removeRoom", { name: room.name })} disabled={busy} onClick={() => void run(() => api.removeRoom(location.id, room.id))}>
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        ),
      )}
      {!location.canEdit ? null : editing === "new" ? (
        <RoomForm teams={managerTeams} busy={busy} onCancel={() => setEditing(null)} onSave={(data) => void run(() => api.addRoom(location.id, { ...data, capacity: data.capacity ?? undefined, managerTeamId: data.managerTeamId ?? undefined }))} />
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setEditing("new")} data-testid="room-add">
          {t("locations.addRoom")}
        </Button>
      )}
    </div>
  );
}

type RoomData = { name: string; capacity: number | null; setupMinutes: number; teardownMinutes: number; needsApproval: boolean; managerTeamId: string | null };

function RoomForm({ initial, teams, busy, onSave, onCancel }: { initial?: LocationRoom; teams: { id: string; name: string }[]; busy: boolean; onSave: (data: RoomData) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [capacity, setCapacity] = useState(initial?.capacity ? String(initial.capacity) : "");
  // Held before and after each event that takes it (bookings, issue #565).
  const [setup, setSetup] = useState(initial?.setupMinutes ? String(initial.setupMinutes) : "");
  const [teardown, setTeardown] = useState(initial?.teardownMinutes ? String(initial.teardownMinutes) : "");
  const [approval, setApproval] = useState({ needsApproval: initial?.needsApproval ?? false, managerTeamId: initial?.managerTeamId ?? "" });
  return (
    <form
      className="flex w-full flex-wrap items-center gap-1.5"
      data-testid="room-form"
      onSubmit={(submitted) => {
        submitted.preventDefault();
        onSave({ name: name.trim(), capacity: capacity ? Number(capacity) : null, setupMinutes: Number(setup) || 0, teardownMinutes: Number(teardown) || 0, needsApproval: approval.needsApproval, managerTeamId: approval.needsApproval && approval.managerTeamId ? approval.managerTeamId : null });
      }}
    >
      <Input className="h-8 w-36 text-xs" value={name} maxLength={80} required autoFocus placeholder={t("locations.roomName")} aria-label={t("locations.roomName")} onChange={(e) => setName(e.target.value)} data-testid="room-name" />
      <Input className="h-8 w-24 text-xs" type="number" min={1} value={capacity} placeholder={t("locations.capacity")} aria-label={t("locations.capacity")} onChange={(e) => setCapacity(e.target.value)} data-testid="room-capacity" />
      <Input className="h-8 w-36 text-xs" type="number" min={0} max={1440} value={setup} placeholder={t("locations.setup")} aria-label={t("locations.setup")} onChange={(e) => setSetup(e.target.value)} data-testid="room-setup" />
      <Input className="h-8 w-36 text-xs" type="number" min={0} max={1440} value={teardown} placeholder={t("locations.teardown")} aria-label={t("locations.teardown")} onChange={(e) => setTeardown(e.target.value)} data-testid="room-teardown" />
      <ApprovalFields id={initial?.id ?? "new-room"} needsApproval={approval.needsApproval} managerTeamId={approval.managerTeamId} teams={teams} onChange={setApproval} />
      <Button type="submit" size="sm" disabled={busy || !name.trim()} data-testid="room-save">
        {t("locations.save")}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        {t("locations.cancel")}
      </Button>
    </form>
  );
}

function LocationEditor({ initial, busy, onSave, onCancel }: { initial?: EventLocation; busy: boolean; onSave: (data: { name: string; address: string; timeZone: string; home: boolean }) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [timeZone, setTimeZone] = useState(initial?.timeZone ?? browserZone());
  const [home, setHome] = useState(initial?.home ?? false);
  const id = initial?.id ?? "new";
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="location-form"
      onSubmit={(submitted) => {
        submitted.preventDefault();
        onSave({ name: name.trim(), address: address.trim(), timeZone, home });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`location-name-${id}`}>{t("locations.name")}</Label>
        <Input id={`location-name-${id}`} value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`location-address-${id}`}>{t("locations.address")}</Label>
        <Input id={`location-address-${id}`} value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4" checked={home} onChange={(e) => setHome(e.target.checked)} data-testid="location-home" />
        <span>
          {t("locations.atHome")}
          <span className="block text-xs text-muted-foreground">{t("locations.atHomeHint")}</span>
        </span>
      </label>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`location-zone-${id}`}>{t("locations.timeZone")}</Label>
        <NativeSelect id={`location-zone-${id}`} value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
          {allZones(timeZone).map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          {t("locations.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("locations.cancel")}
        </Button>
      </div>
    </form>
  );
}
