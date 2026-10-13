import type { OrganizationTeam, TeamRole } from "@songverse/core";
import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "#/components/confirm-button";
import { EntityAvatar } from "#/components/entity-avatar";
import { InviteLinksCard } from "#/components/invite-links-card";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { NativeSelect } from "#/components/ui/native-select";
import { Textarea } from "#/components/ui/textarea";
import { apiClient } from "#/lib/api-client";
import { sizedAvatarUrl } from "#/lib/avatar-url";
import { initials } from "#/lib/initials";
import { forgetMyOrganizations, groupTree } from "#/lib/organizations";

export const Route = createFileRoute("/_protected/organizations/$organizationId")({
  loader: async ({ context, params }) => {
    const organization = await apiClient.getOrganization(params.organizationId).catch(() => null);
    if (!organization) throw redirect({ to: "/organizations" });
    const [members, inviteLinks, mine] = await Promise.all([
      apiClient.listOrganizationMembers(params.organizationId),
      organization.currentUserRole === "ADMIN" ? apiClient.listOrganizationInviteLinks(params.organizationId) : [],
      apiClient.listMyOrganizations(),
    ]);
    return { session: context.session, organization, members, inviteLinks, mode: mine.mode };
  },
  component: OrganizationPage,
});

/**
 * An organisation (issue #241): its teams and members for everyone in it;
 * for its admins, its details, roles, invite links, and taking a team or
 * someone out.
 */
function OrganizationPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, organization, members, inviteLinks, mode } = Route.useLoaderData();
  const isAdmin = organization.currentUserRole === "ADMIN";
  const amMember = members.some((member) => member.userId === session.userId);
  // Its only admin stays until they make someone else one.
  const soleAdmin = members.filter((member) => member.role === "ADMIN").every((member) => member.userId === session.userId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState(organization.name);
  const [description, setDescription] = useState(organization.description ?? "");
  useEffect(() => {
    setName(organization.name);
    setDescription(organization.description ?? "");
  }, [organization]);

  async function run(key: string, action: () => Promise<unknown>, after?: () => void) {
    setBusy(key);
    setError(null);
    try {
      await action();
      if (after) after();
      else await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const leaveOrDelete = (action: () => Promise<unknown>) =>
    run("leave", action, () => {
      forgetMyOrganizations();
      window.location.href = "/organizations";
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <EntityAvatar name={organization.name} color={organization.color} avatarUrl={null} size={48} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold break-words">{organization.name}</h1>
            {organization.description ? <p className="text-sm text-muted-foreground">{organization.description}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <ConfirmButton
              label={t("organizations.delete")}
              confirmLabel={t("organizations.confirmDelete")}
              busyLabel={t("organizations.deleting")}
              cancelLabel={t("teams.cancel")}
              busy={busy === "leave"}
              onConfirm={() => leaveOrDelete(() => apiClient.deleteOrganization(organization.id))}
            />
          ) : null}
          {/* With one organisation for the server, everyone stays in it. */}
          {amMember && mode === "MULTI" && !(isAdmin && soleAdmin) ? (
            <ConfirmButton
              label={t("organizations.leave")}
              confirmLabel={t("organizations.confirmLeave")}
              busyLabel={t("organizations.leaving")}
              cancelLabel={t("teams.cancel")}
              busy={busy === "leave"}
              onConfirm={() => leaveOrDelete(() => apiClient.leaveOrganization(organization.id))}
            />
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid grid-cols-1 items-start gap-6 @6xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card data-testid="organization-teams">
            <CardHeader>
              <CardTitle className="text-sm">{t("organizations.groups")}</CardTitle>
              {isAdmin ? <CardDescription>{t("organizations.addTeamHint")}</CardDescription> : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {organization.teams.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("organizations.noTeams")}</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {/* Each group under the one it's in (issue #241). */}
                  {groupTree(organization.teams).map(({ group: team, depth }) => (
                    <li key={team.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0" style={{ paddingInlineStart: `${depth * 1.5}rem` }} data-team={team.id} data-depth={depth}>
                      <div className="flex min-w-0 items-center gap-3">
                        <EntityAvatar name={team.name} color={team.color} avatarUrl={team.avatarUrl} size={32} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {team.mine ? (
                              <Link to="/teams/$teamId" params={{ teamId: team.id }} className="text-sm font-medium hover:text-primary">
                                {team.name}
                              </Link>
                            ) : (
                              <p className="text-sm font-medium">{team.name}</p>
                            )}
                            {team.usesSongverse ? null : <Badge variant="outline">{t("organizations.onlyPlans")}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("organizations.members", { count: team.memberCount })}
                            {team.mine ? ` · ${t("organizations.yourTeam")}` : ""}
                          </p>
                        </div>
                      </div>
                      {isAdmin ? (
                        <Button variant="ghost" size="sm" disabled={busy === team.id} onClick={() => void run(team.id, () => apiClient.removeOrganizationTeam(organization.id, team.id))}>
                          {t("organizations.takeOut")}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin ? <NewGroupForm organizationId={organization.id} groups={organization.teams} onError={setError} /> : null}
            </CardContent>
          </Card>

          <Card data-testid="organization-members">
            <CardHeader>
              <CardTitle className="text-sm">{t("organizations.people")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y">
                {members.map((member) => {
                  const isSelf = member.userId === session.userId;
                  return (
                    <li key={member.userId} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0" data-member={member.userId}>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="size-8 shrink-0">
                          {member.avatarUrl ? <AvatarImage src={sizedAvatarUrl(member.avatarUrl, 32)} alt="" /> : null}
                          <AvatarFallback className="text-xs">{initials(member.displayName)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {member.displayName}
                            {isSelf ? ` (${t("teams.you")})` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isAdmin && !isSelf ? (
                          <>
                            <NativeSelect
                              value={member.role}
                              disabled={busy === member.userId}
                              onChange={(e) => void run(member.userId, () => apiClient.updateOrganizationMemberRole(organization.id, member.userId, e.target.value as TeamRole))}
                              compact
                              aria-label={t("teams.roleForInvite")}
                            >
                              <option value="MEMBER">{t("teams.roleMember")}</option>
                              <option value="ADMIN">{t("teams.roleAdmin")}</option>
                            </NativeSelect>
                            <Button variant="ghost" size="sm" disabled={busy === member.userId} onClick={() => void run(member.userId, () => apiClient.removeOrganizationMember(organization.id, member.userId))}>
                              {t("teams.remove")}
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">{member.role === "ADMIN" ? t("teams.roleAdmin") : t("teams.roleMember")}</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>

        {isAdmin ? (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("organizations.details")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="organization-name">{t("organizations.name")}</Label>
                  <Input id="organization-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="organization-description">{t("organizations.descriptionLabel")}</Label>
                  <Textarea id="organization-description" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <Button
                  className="self-start"
                  disabled={busy === "details" || name.trim().length < 2}
                  onClick={() =>
                    void run("details", async () => {
                      await apiClient.updateOrganization(organization.id, { name, description });
                      forgetMyOrganizations();
                    })
                  }
                  data-testid="organization-save"
                >
                  {busy === "details" ? t("organizations.saving") : t("organizations.save")}
                </Button>
              </CardContent>
            </Card>
            <InviteLinksCard
              links={inviteLinks}
              description={t("organizations.inviteLinksDescription")}
              path={(token) => `/join-organization/${token}`}
              onCreate={(data) => apiClient.createOrganizationInviteLink(organization.id, data)}
              onRevoke={(linkId) => apiClient.revokeOrganizationInviteLink(organization.id, linkId)}
              onChanged={() => router.invalidate()}
              onError={setError}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** For the organisation's admins: a group of it, that only plans or uses Songverse, under another or at the top. */
function NewGroupForm({ organizationId, groups, onError }: { organizationId: string; groups: OrganizationTeam[]; onError: (message: string) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [usesSongverse, setUsesSongverse] = useState(false);
  const [parentId, setParentId] = useState("");
  const [creating, setCreating] = useState(false);

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)} data-testid="organization-new-group">
        {t("organizations.newGroup")}
      </Button>
    );
  }

  async function create() {
    setCreating(true);
    try {
      const group = await apiClient.createOrganizationGroup(organizationId, { name, usesSongverse, ...(parentId ? { parentId } : {}) });
      await navigate({ to: "/teams/$teamId", params: { teamId: group.id } });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" data-testid="organization-group-form">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="group-name">{t("organizations.name")}</Label>
        <Input id="group-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="group-parent">{t("organizations.under")}</Label>
        <NativeSelect id="group-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">{t("organizations.atTheTop")}</option>
          {groupTree(groups).map(({ group, depth }) => (
            <option key={group.id} value={group.id}>
              {`${"\u00a0\u00a0".repeat(depth)}${group.name}`}
            </option>
          ))}
        </NativeSelect>
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 size-4" checked={usesSongverse} onChange={(e) => setUsesSongverse(e.target.checked)} data-testid="group-uses-songverse" />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{t("organizations.usesSongverse")}</span>
          <span className="text-xs text-muted-foreground">{t("organizations.usesSongverseHint")}</span>
        </span>
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={creating || name.trim().length < 2} onClick={() => void create()} data-testid="group-create">
          {creating ? t("organizations.creating") : t("organizations.createGroup")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("teams.cancel")}
        </Button>
      </div>
    </div>
  );
}
