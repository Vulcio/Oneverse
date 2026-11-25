import { ENTITY_COLORS, type EntityColor, type TeamInviteLink, type TeamRole } from "@oneverse/core";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Textarea } from "@oneverse/ui/components/textarea";
import { usePlanning } from "../host";

/**
 * Invitations by email (issue #550), for a team's admins: an address and a
 * role, an email with a link for one use; those not used yet wait here, to
 * send again or take back.
 */
export function InvitationsCard({ teamId, invitations, onChanged, onError }: { teamId: string; invitations: TeamInviteLink[]; onChanged: () => Promise<unknown>; onError: (message: string) => void }) {
  const { api } = usePlanning();
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("MEMBER");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function run(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    setSent(null);
    try {
      await work();
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const waiting = invitations.filter((one) => one.email && one.usedCount === 0);
  return (
    <Card data-testid="team-invitations">
      <CardHeader>
        <CardTitle className="text-sm">{t("teams.invitationsTitle")}</CardTitle>
        <CardDescription>{t("teams.invitationsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const to = email.trim();
            if (!to) return;
            void run("new", async () => {
              await api.inviteToTeam(teamId, { email: to, role });
              setEmail("");
              setSent(to);
            });
          }}
        >
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Label htmlFor="invite-email">{t("teams.inviteEmail")}</Label>
            <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" data-testid="invite-email" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">{t("teams.roleForInvite")}</Label>
            <NativeSelect id="invite-role" value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
              <option value="MEMBER">{t("teams.roleMember")}</option>
              <option value="ADMIN">{t("teams.roleAdmin")}</option>
            </NativeSelect>
          </div>
          <Button type="submit" disabled={busy !== null} data-testid="invite-send">
            {t("teams.inviteSend")}
          </Button>
        </form>
        {sent ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("teams.inviteSent", { email: sent })}
          </p>
        ) : null}
        {waiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("teams.noInvitations")}</p>
        ) : (
          <ul className="flex flex-col divide-y" aria-label={t("teams.invitationsWaiting")}>
            {waiting.map((one) => (
              <li key={one.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="team-invitation" data-email={one.email ?? ""}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{one.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {one.role === "ADMIN" ? t("teams.roleAdmin") : t("teams.roleMember")}
                    {one.expiresAt ? ` · ${t("teams.expires")} ${new Date(one.expiresAt).toLocaleDateString(i18n.language)}` : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void run(one.id, () => api.inviteToTeam(teamId, { email: one.email!, role: one.role }))} data-testid="invitation-resend">
                    {t("teams.inviteAgain")}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void run(one.id, () => api.revokeTeamInviteLink(teamId, one.id))} data-testid="invitation-revoke">
                    {t("teams.revoke")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A new team (issue #550): its name, description and colour; inside one of
 * the organisations one runs (one of its groups, using Songverse), or under
 * a main team one runs (a sub-team, members not shared) - fixed when made
 * from that team's page. Opens it once made.
 */
export function NewTeamForm({
  organizations = [],
  mainTeams = [],
  under,
  onCancel,
}: {
  organizations?: readonly { id: string; name: string }[];
  mainTeams?: readonly { id: string; name: string }[];
  under?: { id: string; name: string };
  onCancel?: () => void;
}) {
  const { api, links } = usePlanning();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<EntityColor | "">("");
  // "organization:<id>", "team:<id>" or "" (on its own).
  const [inside, setInside] = useState(under ? `team:${under.id}` : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const [kind, id] = inside.split(":");
      const text = description.trim() || undefined;
      const team =
        kind === "organization" && id
          ? await api.createOrganizationGroup(id, { name: name.trim(), description: text, usesSongverse: true })
          : await api.createTeam({ name: name.trim(), description: text, ...(color ? { color } : {}), ...(kind === "team" && id ? { parentId: id } : {}) });
      if (kind === "organization" && color) await api.updateTeam(team.id, { color });
      await navigate({ to: links.team(team.id) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="new-team-form"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-team-name">{t("teams.name")}</Label>
        <Input id="new-team-name" value={name} minLength={2} maxLength={100} required onChange={(e) => setName(e.target.value)} data-testid="new-team-name" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-team-description">{t("teams.descriptionLabel")}</Label>
        <Textarea id="new-team-description" value={description} maxLength={500} rows={2} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-team-color">{t("appearance.color")}</Label>
        <NativeSelect id="new-team-color" value={color} onChange={(e) => setColor(e.target.value as EntityColor | "")}>
          <option value="">{t("appearance.colorFromName")}</option>
          {ENTITY_COLORS.map((key) => (
            <option key={key} value={key}>
              {t(`appearance.colors.${key}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {under ? (
        <p className="text-sm text-muted-foreground">{t("teams.subTeamOf", { name: under.name })}</p>
      ) : organizations.length + mainTeams.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-team-inside">{t("teams.inside")}</Label>
          <NativeSelect id="new-team-inside" value={inside} onChange={(e) => setInside(e.target.value)} data-testid="new-team-inside">
            <option value="">{t("teams.onItsOwn")}</option>
            {organizations.length > 0 ? (
              <optgroup label={t("nav.organizations")}>
                {organizations.map((one) => (
                  <option key={one.id} value={`organization:${one.id}`}>
                    {one.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {mainTeams.length > 0 ? (
              <optgroup label={t("teams.underMainTeam")}>
                {mainTeams.map((one) => (
                  <option key={one.id} value={`team:${one.id}`}>
                    {one.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </NativeSelect>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || name.trim().length < 2} data-testid="new-team-create">
          {t("teams.createTeam")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("teams.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
