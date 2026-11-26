import type { EventLocation, EventResourceUse, Resource } from "@oneverse/core";
import { Package, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { FieldError } from "@oneverse/ui/components/field";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { usePlanning } from "../host";
import { ApprovalFields, BookingsButton, useManagerTeams } from "./bookings";

type Owner = { teamId: string } | { organizationId: string };

/** What an event takes, as a form keeps it: how many of each resource. */
export type ResourceChoice = { resourceId: string; quantity: number };

/** The resources an event can take (issue #564): a team's own and its organisation's, or an organisation's. */
export function useResources(owner: Owner | null) {
  const { api } = usePlanning();
  const [resources, setResources] = useState<Resource[]>([]);
  const key = JSON.stringify(owner);
  useEffect(() => {
    if (!owner) return;
    let live = true;
    api
      .listResources(owner)
      .then((list) => live && setResources(list))
      .catch(() => live && setResources([]));
    return () => {
      live = false;
    };
  }, [key]);
  return resources;
}

/** A form's starting choice from what an event or a type takes. */
export const resourceChoices = (uses: EventResourceUse[] | undefined): ResourceChoice[] => (uses ?? []).map(({ resourceId, quantity }) => ({ resourceId, quantity }));

/**
 * The resources an event takes (issue #564), shown when its owner has any:
 * ticked, and how many when there are several.
 */
export function ResourcesField({ resources, value, onChange }: { resources: Resource[]; value: ResourceChoice[]; onChange: (next: ResourceChoice[]) => void }) {
  const { t } = useTranslation();
  if (resources.length === 0 && value.length === 0) return null;
  const taken = new Map(value.map((one) => [one.resourceId, one.quantity]));
  const set = (resourceId: string, quantity: number | null) => onChange(quantity === null ? value.filter((one) => one.resourceId !== resourceId) : [...value.filter((one) => one.resourceId !== resourceId), { resourceId, quantity }]);
  return (
    <fieldset className="col-span-2 flex flex-col gap-1.5" data-testid="event-resources">
      <legend className="mb-1.5 text-sm font-medium">{t("resources.title")}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {resources.map((resource) => {
          const quantity = taken.get(resource.id);
          return (
            <span key={resource.id} className="flex items-center gap-2 text-sm" data-testid="event-resource" data-resource={resource.name}>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4" checked={quantity !== undefined} onChange={(e) => set(resource.id, e.target.checked ? 1 : null)} />
                {resource.name}
              </label>
              {quantity !== undefined && resource.quantity > 1 ? (
                <Input
                  type="number"
                  min={1}
                  max={resource.quantity}
                  value={quantity}
                  className="h-7 w-16 text-xs"
                  aria-label={t("resources.howMany", { name: resource.name })}
                  onChange={(e) => set(resource.id, Math.min(resource.quantity, Math.max(1, Number(e.target.value) || 1)))}
                  data-testid="event-resource-quantity"
                />
              ) : null}
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A team's or an organisation's resources (issue #564), on its page for its
 * admins: the van, the portable PA - how many, and the venue they're kept at.
 */
export function ResourcesCard({ owner }: { owner: Owner }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [resources, setResources] = useState<Resource[]>([]);
  const [venues, setVenues] = useState<EventLocation[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ownerId = "teamId" in owner ? owner.teamId : owner.organizationId;
  const key = JSON.stringify(owner);
  const managerTeams = useManagerTeams(owner);

  // Its own only: a team's list also holds its organisation's.
  const load = async () => {
    const [list, places] = await Promise.all([api.listResources(owner), api.listLocations(owner)]);
    setResources(list.filter((one) => one.owner.id === ownerId));
    setVenues(places.filter((one) => one.owner.id === ownerId));
  };
  useEffect(() => {
    void load().catch(() => setResources([]));
  }, [key]);

  // The venues may have changed on the page since: looked at again.
  const edit = (id: string) => {
    setEditing(id);
    void load().catch(() => {});
  };

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
    <Card data-testid="resources-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Package className="size-4 text-muted-foreground" aria-hidden />
          {t("resources.title")}
        </CardTitle>
        <CardDescription>{t("resources.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {resources.length === 0 && editing !== "new" ? <p className="text-sm text-muted-foreground">{t("resources.empty")}</p> : null}
        {resources.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {resources.map((resource) =>
              editing === resource.id ? (
                <li key={resource.id} className="py-2 first:pt-0">
                  <ResourceEditor initial={resource} venues={venues} teams={managerTeams} busy={busy === resource.id} onCancel={() => setEditing(null)} onSave={(data) => run(resource.id, () => api.updateResource(resource.id, { ...data, locationId: data.locationId || null }))} />
                </li>
              ) : (
                <li key={resource.id} className="flex items-start justify-between gap-2 py-2 first:pt-0" data-testid="resource-row" data-resource={resource.name}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {resource.name}
                      {resource.quantity > 1 ? <span className="text-muted-foreground"> ×{resource.quantity}</span> : null}
                    </p>
                    {resource.location ? <p className="truncate text-xs text-muted-foreground">{t("resources.keptAt", { venue: resource.location.name })}</p> : null}
                    {resource.needsApproval ? (
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground" data-testid="resource-approval">
                        <ShieldCheck className="size-3" aria-hidden />
                        {t("bookings.approvedBy")}: {resource.managerTeam ? t("bookings.teamAdmins", { team: resource.managerTeam.name }) : t("bookings.itsAdmins")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <BookingsButton title={resource.name} load={(from, to) => api.resourceBookings(resource.id, from, to)} />
                    <Button variant="ghost" size="sm" onClick={() => edit(resource.id)}>
                      {t("locations.edit")}
                    </Button>
                    <ConfirmButton
                      label={t("locations.remove")}
                      confirmLabel={t("locations.remove")}
                      busyLabel={t("locations.remove")}
                      cancelLabel={t("locations.cancel")}
                      busy={busy === resource.id}
                      onConfirm={() => run(resource.id, () => api.deleteResource(resource.id))}
                    />
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : null}
        {editing === "new" ? (
          <ResourceEditor venues={venues} teams={managerTeams} busy={busy === "new"} onCancel={() => setEditing(null)} onSave={(data) => run("new", () => api.createResource({ name: data.name, quantity: data.quantity, ...(data.locationId ? { locationId: data.locationId } : {}), needsApproval: data.needsApproval, ...(data.managerTeamId ? { managerTeamId: data.managerTeamId } : {}), ...owner }))} />
        ) : (
          <Button variant="outline" size="sm" className="self-start" onClick={() => edit("new")} data-testid="resource-add">
            {t("resources.add")}
          </Button>
        )}
        {error ? <FieldError>{error}</FieldError> : null}
      </CardContent>
    </Card>
  );
}

function ResourceEditor({ initial, venues, teams, busy, onSave, onCancel }: { initial?: Resource; venues: EventLocation[]; teams: { id: string; name: string }[]; busy: boolean; onSave: (data: { name: string; quantity: number; locationId: string; needsApproval: boolean; managerTeamId: string | null }) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [approval, setApproval] = useState({ needsApproval: initial?.needsApproval ?? false, managerTeamId: initial?.managerTeam?.id ?? "" });
  const [name, setName] = useState(initial?.name ?? "");
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1));
  const [locationId, setLocationId] = useState(initial?.location?.id ?? "");
  const id = initial?.id ?? "new";
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="resource-form"
      onSubmit={(submitted) => {
        submitted.preventDefault();
        onSave({ name: name.trim(), quantity: Math.max(1, Number(quantity) || 1), locationId, needsApproval: approval.needsApproval, managerTeamId: approval.needsApproval && approval.managerTeamId ? approval.managerTeamId : null });
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`resource-name-${id}`}>{t("locations.name")}</Label>
          <Input id={`resource-name-${id}`} value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`resource-quantity-${id}`}>{t("resources.quantity")}</Label>
          <Input id={`resource-quantity-${id}`} type="number" min={1} max={1000} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      </div>
      {venues.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`resource-venue-${id}`}>{t("resources.keptAtLabel")}</Label>
          <NativeSelect id={`resource-venue-${id}`} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t("resources.nowhere")}</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      <ApprovalFields id={id} needsApproval={approval.needsApproval} managerTeamId={approval.managerTeamId} teams={teams} onChange={setApproval} />
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
