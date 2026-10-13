import type { OrganizationDetail, OrganizationSummary, TeamPosition, TeamSummary } from "@songverse/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePlanning } from "../host";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Label } from "@songverse/ui/components/label";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { Input } from "@songverse/ui/components/input";
import { X } from "lucide-react";
import { cn } from "@songverse/ui/lib/utils";
import { groupTree, withSubgroups } from "../organizations";

/** A team's organisation (issue #241), for its admins: one of those they run, or none. */
export function TeamOrganizationCard({
  teamId,
  current,
  organizations,
  onChanged,
  onError,
}: {
  teamId: string;
  current: { id: string; name: string } | null;
  organizations: OrganizationSummary[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [choice, setChoice] = useState(current?.id ?? "");
  const [saving, setSaving] = useState(false);
  const choices = organizations.filter((organization) => organization.currentUserRole === "ADMIN" && organization.id !== current?.id);
  if (!current && choices.length === 0) return null;

  async function save() {
    setSaving(true);
    try {
      await api.setTeamOrganization(teamId, choice || null);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="team-organization-card">
      <CardHeader>
        <CardTitle className="text-sm">{t("organizations.teamCard")}</CardTitle>
        <CardDescription>{t("organizations.teamCardHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="team-organization">{t("organizations.organization")}</Label>
          <NativeSelect id="team-organization" value={choice} onChange={(e) => setChoice(e.target.value)} data-testid="team-organization-select">
            <option value="">{t("organizations.teamNone")}</option>
            {current ? <option value={current.id}>{current.name}</option> : null}
            {choices.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button disabled={saving || choice === (current?.id ?? "")} onClick={() => void save()} data-testid="team-organization-save">
          {saving ? t("organizations.saving") : t("organizations.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

/** A group's own positions (issue #241): its admins add and remove them. */
export function PositionsCard({ teamId, positions, isAdmin, onChanged, onError }: { teamId: string; positions: TeamPosition[]; isAdmin: boolean; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="team-positions">
      <CardHeader>
        <CardTitle className="text-sm">{t("organizations.positions")}</CardTitle>
        <CardDescription>{t("organizations.positionsHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("organizations.noPositions")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {positions.map((position) => (
              <li key={position.id} className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm" data-position={position.name}>
                {position.name}
                {isAdmin ? (
                  <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={t("organizations.removePosition", { name: position.name })} disabled={busy} onClick={() => void run(() => api.deleteTeamPosition(teamId, position.id))}>
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {isAdmin ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api.createTeamPosition(teamId, name.trim());
                setName("");
              });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="position-name">{t("organizations.newPosition")}</Label>
              <Input id="position-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="w-48" />
            </div>
            <Button type="submit" variant="outline" disabled={busy || !name.trim()} data-testid="position-add">
              {t("organizations.addPosition")}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The group's positions someone covers: toggled by them or its admins, shown to the others. */
export function MemberPositions({
  teamId,
  userId,
  positions,
  covered,
  editable,
  onChanged,
  onError,
}: {
  teamId: string;
  userId: string;
  positions: TeamPosition[];
  covered: string[];
  editable: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { api } = usePlanning();
  const [busy, setBusy] = useState(false);
  const shown = editable ? positions : positions.filter((position) => covered.includes(position.id));
  if (shown.length === 0) return null;

  async function toggle(id: string) {
    setBusy(true);
    try {
      await api.setTeamMemberPositions(teamId, userId, covered.includes(id) ? covered.filter((one) => one !== id) : [...covered, id]);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-1" data-member-positions={userId}>
      {shown.map((position) => {
        const on = covered.includes(position.id);
        return editable ? (
          <button
            key={position.id}
            type="button"
            aria-pressed={on}
            disabled={busy}
            onClick={() => void toggle(position.id)}
            className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {position.name}
          </button>
        ) : (
          <span key={position.id} className="rounded-full border border-primary bg-primary px-2 py-0.5 text-xs text-primary-foreground">
            {position.name}
          </span>
        );
      })}
    </div>
  );
}

/** For a group's admins (issue #241): whether it uses Songverse, and the group it's under. */
export function GroupCard({ team, organization, onChanged, onError }: { team: TeamSummary; organization: OrganizationDetail; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [usesSongverse, setUsesSongverse] = useState(team.usesSongverse !== false);
  const [parentId, setParentId] = useState(team.parentId ?? "");
  const [saving, setSaving] = useState(false);
  // Not under itself or a group under it.
  const excluded = withSubgroups(organization.teams, team.id);
  const changed = usesSongverse !== (team.usesSongverse !== false) || parentId !== (team.parentId ?? "");

  async function save() {
    setSaving(true);
    try {
      await api.updateTeamGroup(team.id, { usesSongverse, parentId: parentId || null });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="team-group-card">
      <CardHeader>
        <CardTitle className="text-sm">{t("organizations.groupCard")}</CardTitle>
        <CardDescription>{t("organizations.groupCardHint", { name: organization.name })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="team-parent">{t("organizations.under")}</Label>
          <NativeSelect id="team-parent" value={parentId} onChange={(e) => setParentId(e.target.value)} data-testid="team-parent">
            <option value="">{t("organizations.atTheTop")}</option>
            {groupTree(organization.teams)
              .filter(({ group }) => !excluded.has(group.id))
              .map(({ group, depth }) => (
                <option key={group.id} value={group.id}>
                  {`${"\u00a0\u00a0".repeat(depth)}${group.name}`}
                </option>
              ))}
          </NativeSelect>
        </div>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-4" checked={usesSongverse} onChange={(e) => setUsesSongverse(e.target.checked)} data-testid="team-uses-songverse" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{t("organizations.usesSongverse")}</span>
            <span className="text-xs text-muted-foreground">{t("organizations.usesSongverseHint")}</span>
          </span>
        </label>
        <Button className="self-start" disabled={saving || !changed} onClick={() => void save()} data-testid="team-group-save">
          {saving ? t("organizations.saving") : t("organizations.save")}
        </Button>
      </CardContent>
    </Card>
  );
}
