import type { ApiClient, TeamRole } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RoleBadges } from "../components/role-badges";
import { Avatar, AvatarFallback, AvatarImage } from "@oneverse/ui/components/avatar";
import { HostLink, usePlanning } from "../host";
import { sizedAvatarUrl } from "@oneverse/ui/lib/avatar-url";
import { initials } from "@oneverse/ui/lib/initials";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { Pencil } from "lucide-react";
import { CalendarFeedCard } from "../components/calendar-feed-card";
import { InviteLinksCard } from "../components/invite-links-card";
import { LocationsCard } from "../components/locations";
import { GroupCard, MemberPositions, PositionsCard, TeamOrganizationCard } from "../components/team-cards";
import { TeamCalendar } from "../components/team-calendar";
import { NewGroupForm } from "./organization";

/** What a team's (a group's) page needs, or null when there's no such team or it isn't theirs. */
export async function loadTeamPage(api: ApiClient, teamId: string) {
  const team = await api.getTeam(teamId).catch(() => null);
  if (!team) return null;
  const [members, inviteLinks, customInstruments, organizations, positions, organization] = await Promise.all([
    api.listTeamMembers(teamId),
    team.currentUserRole === "ADMIN" ? api.listTeamInviteLinks(teamId) : [],
    api.listCustomInstruments(),
    api.listMyOrganizations().catch(() => null),
    api.listTeamPositions(teamId),
    // Its organisation's groups (issue #241), for where it sits.
    team.organization ? api.getOrganization(team.organization.id).catch(() => null) : null,
  ]);
  return { team, members, inviteLinks, customInstruments, organizations, positions, organization };
}

/**
 * A team, or an organisation's group (issue #241): its calendar, members and
 * their positions; for its admins, roles, positions, where it sits, invite
 * links, and the app's own cards (`adminCards`: Songverse's look).
 */
export function TeamPage({ userId, data, adminCards }: { userId: string; data: NonNullable<Awaited<ReturnType<typeof loadTeamPage>>>; adminCards?: ReactNode }) {
  const { api, links } = usePlanning();
  const { t } = useTranslation();
  const router = useRouter();
  const { team, members, inviteLinks, customInstruments, organizations, positions, organization } = data;
  const isAdmin = team.currentUserRole === "ADMIN";

  const isSoleMember = members.length === 1;
  const isSoleAdmin = isAdmin && members.filter((m) => m.role === "ADMIN").length === 1;
  const otherMembers = members.filter((m) => m.userId !== userId);

  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [promotingBeforeLeave, setPromotingBeforeLeave] = useState(false);
  const [promoteTargetUserId, setPromoteTargetUserId] = useState("");

  const [deleting, setDeleting] = useState(false);
  // Renaming it (issue #244): a team, or an organisation's group.
  const [newName, setNewName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  async function rename() {
    if (!newName?.trim()) return;
    setRenaming(true);
    setError(null);
    try {
      await api.updateTeam(team.id, { name: newName.trim() });
      setNewName(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenaming(false);
    }
  }

  async function refresh() {
    await router.invalidate();
  }

  async function changeRole(userId: string, role: TeamRole) {
    setBusyUserId(userId);
    setError(null);
    try {
      await api.updateTeamMemberRole(team.id, userId, role);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeMember(userId: string) {
    setBusyUserId(userId);
    setError(null);
    try {
      await api.removeTeamMember(team.id, userId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyUserId(null);
    }
  }

  async function deleteTeam() {
    setDeleting(true);
    try {
      await api.deleteTeam(team.id);
      window.location.href = links.teams;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  async function leaveTeam() {
    setLeaving(true);
    setError(null);
    try {
      await api.leaveTeam(team.id);
      window.location.href = links.home;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLeaving(false);
    }
  }

  async function promoteAndLeave() {
    if (!promoteTargetUserId) return;
    setLeaving(true);
    setError(null);
    try {
      await api.updateTeamMemberRole(team.id, promoteTargetUserId, "ADMIN");
      await api.leaveTeam(team.id);
      window.location.href = links.home;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLeaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <EntityAvatar name={team.name} color={team.color} avatarUrl={team.avatarUrl} size={48} />
          <div className="min-w-0">
            {newName !== null ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void rename();
                }}
              >
                <Input value={newName} minLength={2} maxLength={100} autoFocus aria-label={t("teams.newName")} className="w-64" onChange={(e) => setNewName(e.target.value)} data-testid="team-name-input" />
                <Button type="submit" size="sm" disabled={renaming || newName.trim().length < 2} data-testid="team-name-save">
                  {t("teams.saveName")}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={renaming} onClick={() => setNewName(null)}>
                  {t("teams.cancel")}
                </Button>
              </form>
            ) : (
              <div className="flex items-center gap-1">
                <h1 className="text-2xl font-semibold break-words">{team.name}</h1>
                {isAdmin ? (
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={t("teams.rename")} title={t("teams.rename")} onClick={() => setNewName(team.name)} data-testid="team-rename">
                    <Pencil />
                  </Button>
                ) : null}
              </div>
            )}
            {team.description ? <p className="text-sm text-muted-foreground">{team.description}</p> : null}
            {team.organization && organizations && organizations.mode !== "NONE" ? (
              <HostLink href={links.organization(team.organization.id)} className="text-xs text-muted-foreground hover:text-primary" data-testid="team-organization">
                {t("organizations.partOf", { name: team.organization.name })}
              </HostLink>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <ConfirmButton
              label={t("teams.deleteTeam")}
              confirmLabel={t("teams.confirmDeleteTeam")}
              busyLabel={t("teams.deletingTeam")}
              cancelLabel={t("teams.cancel")}
              busy={deleting}
              onConfirm={deleteTeam}
            />
          ) : null}
          {isSoleMember ? null : isSoleAdmin ? (
            promotingBeforeLeave ? (
              <div className="flex items-center gap-2">
                <NativeSelect
                  value={promoteTargetUserId}
                  onChange={(e) => setPromoteTargetUserId(e.target.value)}
                  disabled={leaving}
                  compact
                >
                  <option value="">{t("teams.chooseMember")}</option>
                  {otherMembers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void promoteAndLeave()}
                  disabled={!promoteTargetUserId || leaving}
                >
                  {leaving ? t("teams.leaving") : t("teams.promoteAndLeave")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPromotingBeforeLeave(false)} disabled={leaving}>
                  {t("teams.cancel")}
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setPromotingBeforeLeave(true)}>
                {t("teams.leaveTeam")}
              </Button>
            )
          ) : (
            <ConfirmButton
              label={t("teams.leaveTeam")}
              confirmLabel={t("teams.confirmLeave")}
              busyLabel={t("teams.leaving")}
              cancelLabel={t("teams.cancel")}
              busy={leaving}
              onConfirm={leaveTeam}
            />
          )}
        </div>
      </div>
      {promotingBeforeLeave ? (
        <p className="text-sm text-muted-foreground">{t("teams.promoteBeforeLeaveDescription")}</p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* Its services and rehearsals, each date with its set (issue #235). */}
      <TeamCalendar teamId={team.id} isAdmin={isAdmin} customInstruments={customInstruments} withSets={team.usesSongverse !== false} positions={positions} />

      <div className="grid grid-cols-1 items-start gap-6 @6xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("teams.members")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {members.map((member) => {
              const isSelf = member.userId === userId;
              return (
                <li key={member.userId} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-8 shrink-0">
                      {member.avatarUrl ? <AvatarImage src={sizedAvatarUrl(member.avatarUrl, 32)} alt="" /> : null}
                      <AvatarFallback className="text-xs">{initials(member.displayName)}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col gap-1">
                      <div>
                        <p className="text-sm font-medium">
                          {member.displayName}
                          {isSelf ? ` (${t("teams.you")})` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      </div>
                      <RoleBadges instruments={member.instruments} techRoles={member.techRoles} customInstruments={customInstruments} />
                      {/* The group's own positions they cover (issue #241): they and its admins tick them. */}
                      <MemberPositions teamId={team.id} userId={member.userId} positions={positions} covered={member.positionIds ?? []} editable={isAdmin || isSelf} onChanged={refresh} onError={setError} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin && !isSelf ? (
                      <NativeSelect
                        value={member.role}
                        disabled={busyUserId === member.userId}
                        onChange={(e) => void changeRole(member.userId, e.target.value as TeamRole)}
                        compact
                      >
                        <option value="MEMBER">{t("teams.roleMember")}</option>
                        <option value="ADMIN">{t("teams.roleAdmin")}</option>
                      </NativeSelect>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {member.role === "ADMIN" ? t("teams.roleAdmin") : t("teams.roleMember")}
                      </span>
                    )}
                    {isAdmin && !isSelf ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void removeMember(member.userId)}
                        disabled={busyUserId === member.userId}
                      >
                        {t("teams.remove")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      {/* Beside its members (issue #177): its look and its invite links, for its admins. */}
      <div className="flex flex-col gap-6">

      {/* The app's own, for its admins (Songverse's: its colour and picture, issue #161). */}
      {isAdmin ? adminCards : null}

      {/* Its calendar link (issue #240): all its dates, for a shared calendar or a website. */}
      {isAdmin ? <CalendarFeedCard teamId={team.id} /> : null}

      {/* Where its events take place (issue #320). */}
      {isAdmin ? <LocationsCard owner={{ teamId: team.id }} /> : null}

      {isAdmin || positions.length > 0 ? <PositionsCard teamId={team.id} positions={positions} isAdmin={isAdmin} onChanged={refresh} onError={setError} /> : null}

      {/* Where it sits in its organisation, and whether it uses Songverse (issue #241). */}
      {isAdmin && organization ? <GroupCard team={team} organization={organization} onChanged={refresh} onError={setError} /> : null}
      {/* A group under it, made by its admins (issue #245). */}
      {isAdmin && organization ? <NewGroupForm organizationId={organization.id} groups={organization.teams} under={{ id: team.id, name: team.name }} onError={setError} /> : null}

      {/* The organisation it's part of (issue #241): its admins choose among those they run. */}
      {isAdmin && organizations && organizations.mode !== "NONE" ? <TeamOrganizationCard teamId={team.id} current={team.organization ?? null} organizations={organizations.organizations} onChanged={refresh} onError={setError} /> : null}

      {isAdmin ? (
        <InviteLinksCard
          links={inviteLinks}
          description={t("teams.inviteLinksDescription")}
          path={(token) => `/join/${token}`}
          onCreate={(data) => api.createTeamInviteLink(team.id, data)}
          onRevoke={(linkId) => api.revokeTeamInviteLink(team.id, linkId)}
          onChanged={refresh}
          onError={setError}
        />
      ) : null}
      </div>
      </div>
    </div>
  );
}
