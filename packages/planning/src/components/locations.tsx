import type { EventLocation } from "@oneverse/core";
import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { usePlanning } from "../host";

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
 * An event's location (issue #320), shown when its owner has any. Picking
 * one fills the place (unless one of its own was typed) and the time zone.
 */
export function LocationField({ id, locations, value, place, onChange }: { id: string; locations: EventLocation[]; value: string; place: string; onChange: (change: { locationId: string; place?: string; timeZone?: string }) => void }) {
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
        }}
      >
        <option value="">{t("teamCalendar.noLocation")}</option>
        {locations.map((one) => (
          <option key={one.id} value={one.id}>
            {one.name}
          </option>
        ))}
      </NativeSelect>
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
                    <p className="truncate text-sm font-medium">{location.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{[location.address, location.timeZone.replaceAll("_", " ")].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
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
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function LocationEditor({ initial, busy, onSave, onCancel }: { initial?: EventLocation; busy: boolean; onSave: (data: { name: string; address: string; timeZone: string }) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [timeZone, setTimeZone] = useState(initial?.timeZone ?? browserZone());
  const id = initial?.id ?? "new";
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="location-form"
      onSubmit={(submitted) => {
        submitted.preventDefault();
        onSave({ name: name.trim(), address: address.trim(), timeZone });
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
