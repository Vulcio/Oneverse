import type { TeamRole } from "@songverse/core";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RoleBadges } from "#/components/role-badges";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { apiClient } from "#/lib/api-client";
import { sizedAvatarUrl } from "#/lib/avatar-url";
import { initials } from "#/lib/initials";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { AppearanceCard } from "#/components/appearance-card";
import { EntityAvatar } from "#/components/entity-avatar";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { NativeSelect } from "#/components/ui/native-select";
import { ConfirmButton } from "#/components/confirm-button";
import { TeamCalendar } from "#/components/team-calendar";

export const Route = createFileRoute("/_protected/teams/$teamId")({
  loader: async ({ context, params }) => {
    const team = await apiClient.getTeam(params.teamId).catch(() => null);
    if (!team) throw redirect({ to: "/dashboard" });

    const [members, inviteLinks, customInstruments] = await Promise.all([
      apiClient.listTeamMembers(params.teamId),
      team.currentUserRole === "ADMIN" ? apiClient.listTeamInviteLinks(params.teamId) : [],
      apiClient.listCustomInstruments(),
    ]);
    return { session: context.session, team, members, inviteLinks, customInstruments };
  },
  component: TeamDetail,
});

function TeamDetail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, team, members, inviteLinks, customInstruments } = Route.useLoaderData();
  const isAdmin = team.currentUserRole === "ADMIN";

  const isSoleMember = members.length === 1;
  const isSoleAdmin = isAdmin && members.filter((m) => m.role === "ADMIN").length === 1;
  const otherMembers = members.filter((m) => m.userId !== session.userId);

  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [promotingBeforeLeave, setPromotingBeforeLeave] = useState(false);
  const [promoteTargetUserId, setPromoteTargetUserId] = useState("");

  const [deleting, setDeleting] = useState(false);

  const [linkRole, setLinkRole] = useState<TeamRole>("MEMBER");
  const [linkExpiresInDays, setLinkExpiresInDays] = useState("");
  const [linkMaxUses, setLinkMaxUses] = useState("");
  const [creatingLink, setCreatingLink] = useState(false);
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null);

  async function refresh() {
    await router.invalidate();
  }

  async function changeRole(userId: string, role: TeamRole) {
    setBusyUserId(userId);
    setError(null);
    try {
      await apiClient.updateTeamMemberRole(team.id, userId, role);
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
      await apiClient.removeTeamMember(team.id, userId);
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
      await apiClient.deleteTeam(team.id);
      window.location.href = "/teams";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  async function leaveTeam() {
    setLeaving(true);
    setError(null);
    try {
      await apiClient.leaveTeam(team.id);
      window.location.href = "/dashboard";
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
      await apiClient.updateTeamMemberRole(team.id, promoteTargetUserId, "ADMIN");
      await apiClient.leaveTeam(team.id);
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLeaving(false);
    }
  }

  async function createInviteLink() {
    setCreatingLink(true);
    setError(null);
    try {
      await apiClient.createTeamInviteLink(team.id, {
        role: linkRole,
        expiresInDays: linkExpiresInDays ? Number(linkExpiresInDays) : undefined,
        maxUses: linkMaxUses ? Number(linkMaxUses) : undefined,
      });
      setLinkExpiresInDays("");
      setLinkMaxUses("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingLink(false);
    }
  }

  async function revokeLink(linkId: string) {
    setBusyLinkId(linkId);
    setError(null);
    try {
      await apiClient.revokeTeamInviteLink(team.id, linkId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyLinkId(null);
    }
  }

  function inviteUrl(token: string): string {
    return `${window.location.origin}/join/${token}`;
  }

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(inviteUrl(token));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <EntityAvatar name={team.name} color={team.color} avatarUrl={team.avatarUrl} size={48} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold break-words">{team.name}</h1>
            {team.description ? <p className="text-sm text-muted-foreground">{team.description}</p> : null}
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
      <TeamCalendar teamId={team.id} isAdmin={isAdmin} customInstruments={customInstruments} />

      <div className="grid grid-cols-1 items-start gap-6 @6xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("teams.members")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {members.map((member) => {
              const isSelf = member.userId === session.userId;
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

      {/* Its colour and picture (issue #161), for its admins. */}
      {isAdmin ? (
        <AppearanceCard
          owner="teams"
          id={team.id}
          name={team.name}
          color={team.color}
          avatarUrl={team.avatarUrl}
          onColor={(color) => apiClient.updateTeam(team.id, { color })}
          onChanged={() => router.invalidate()}
        />
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("teams.inviteLinks")}</CardTitle>
            <CardDescription>{t("teams.inviteLinksDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="link-role">{t("teams.roleForInvite")}</Label>
                <NativeSelect
                  id="link-role"
                  value={linkRole}
                  onChange={(e) => setLinkRole(e.target.value as TeamRole)}
                >
                  <option value="MEMBER">{t("teams.roleMember")}</option>
                  <option value="ADMIN">{t("teams.roleAdmin")}</option>
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="link-expires">{t("teams.expiresInDays")}</Label>
                <Input
                  id="link-expires"
                  type="number"
                  min={1}
                  max={365}
                  value={linkExpiresInDays}
                  onChange={(e) => setLinkExpiresInDays(e.target.value)}
                  placeholder={t("teams.never")}
                  className="w-28"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="link-max-uses">{t("teams.maxUses")}</Label>
                <Input
                  id="link-max-uses"
                  type="number"
                  min={1}
                  value={linkMaxUses}
                  onChange={(e) => setLinkMaxUses(e.target.value)}
                  placeholder={t("teams.unlimited")}
                  className="w-28"
                />
              </div>
              <Button onClick={() => void createInviteLink()} disabled={creatingLink}>
                {creatingLink ? t("teams.creatingLink") : t("teams.createInviteLink")}
              </Button>
            </div>

            {inviteLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("teams.noInviteLinksYet")}</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {inviteLinks.map((link) => (
                  <li key={link.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">{inviteUrl(link.token)}</p>
                      <p className="text-xs text-muted-foreground">
                        {link.role === "ADMIN" ? t("teams.roleAdmin") : t("teams.roleMember")} ·{" "}
                        {link.usedCount}
                        {link.maxUses !== null ? `/${link.maxUses}` : ""} {t("teams.uses")}
                        {link.expiresAt
                          ? ` · ${t("teams.expires")} ${new Date(link.expiresAt).toLocaleDateString()}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => void copyLink(link.token)}>
                        {t("teams.copyLink")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void revokeLink(link.id)}
                        disabled={busyLinkId === link.id}
                      >
                        {t("teams.revoke")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
      </div>
      </div>
    </div>
  );
}
