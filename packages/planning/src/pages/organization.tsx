import type { OrganizationTeam, TeamRole } from "@oneverse/core";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { InviteLinksCard } from "../components/invite-links-card";
import { LocationsCard } from "../components/locations";
import { OrganizationSetupCard } from "../components/organization-setup";
import { Avatar, AvatarFallback, AvatarImage } from "@oneverse/ui/components/avatar";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Textarea } from "@oneverse/ui/components/textarea";
import { HostLink, usePlanning } from "../host";
import { loadOrganizationPage } from "../loaders";

export { loadOrganizationPage };
import { sizedAvatarUrl } from "@oneverse/ui/lib/avatar-url";
import { initials } from "@oneverse/ui/lib/initials";
import { forgetMyOrganizations, groupTree } from "../organizations";

/**
 * An organisation (issue #241): its teams and members for everyone in it;
 * for its admins, its details, roles, invite links, and taking a team or
 * someone out, and the app's own cards (`adminCards`: Songverse's brands).
 */

export function OrganizationPage({
  userId,
  data,
  adminCards,
  setupOnPage = { roles: false, storage: false, sonic: false },
}: {
  userId: string;
  data: NonNullable<Awaited<ReturnType<typeof loadOrganizationPage>>>;
  adminCards?: ReactNode;
  /** Which of the setup checklist's steps the app's own cards (`adminCards`) show on this page (issue #364). */
  setupOnPage?: { roles: boolean; storage: boolean; sonic: boolean };
}) {
  const { api, links } = usePlanning();
  const { t } = useTranslation();
  const router = useRouter();
  const { organization, members, inviteLinks, mode } = data;
  const isAdmin = organization.currentUserRole === "ADMIN";
  const amMember = members.some((member) => member.userId === userId);
  // Its only admin stays until they make someone else one.
  const soleAdmin = members.filter((member) => member.role === "ADMIN").every((member) => member.userId === userId);
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
      window.location.href = links.organizations;
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
          {/* Its events (issue #241): who hosts each, which groups it needs. */}
          <Button variant="outline" size="sm" render={<HostLink href={links.organizationEvents(organization.id)} />} data-testid="organization-events">
            <CalendarDays />
            {t("organizations.events")}
          </Button>
          {isAdmin ? (
            <ConfirmButton
              label={t("organizations.delete")}
              confirmLabel={t("organizations.confirmDelete")}
              busyLabel={t("organizations.deleting")}
              cancelLabel={t("teams.cancel")}
              busy={busy === "leave"}
              onConfirm={() => leaveOrDelete(() => api.deleteOrganization(organization.id))}
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
              onConfirm={() => leaveOrDelete(() => api.leaveOrganization(organization.id))}
            />
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* A new organisation's setup, for its admins, until they put it away (issue #364). */}
      {isAdmin && organization.setup && !organization.setup.dismissed ? (
        <OrganizationSetupCard setup={organization.setup} onPage={setupOnPage} onDismiss={() => void run("setup", () => api.updateOrganization(organization.id, { onboardingDone: true }))} />
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 @6xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card id="groups" className="scroll-mt-20" data-testid="organization-teams">
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
                              <HostLink href={links.team(team.id)} className="text-sm font-medium hover:text-primary">
                                {team.name}
                              </HostLink>
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
                        <Button variant="ghost" size="sm" disabled={busy === team.id} onClick={() => void run(team.id, () => api.removeOrganizationTeam(organization.id, team.id))}>
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
                  const isSelf = member.userId === userId;
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
                              onChange={(e) => void run(member.userId, () => api.updateOrganizationMemberRole(organization.id, member.userId, e.target.value as TeamRole))}
                              compact
                              aria-label={t("teams.roleForInvite")}
                            >
                              <option value="MEMBER">{t("teams.roleMember")}</option>
                              <option value="ADMIN">{t("teams.roleAdmin")}</option>
                            </NativeSelect>
                            <Button variant="ghost" size="sm" disabled={busy === member.userId} onClick={() => void run(member.userId, () => api.removeOrganizationMember(organization.id, member.userId))}>
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
            {/* The app's own, for its admins (Songverse's: its brands, issue #279). */}
            {adminCards}
            {/* Where its events take place (issue #320). */}
            <LocationsCard owner={{ organizationId: organization.id }} />
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
                      await api.updateOrganization(organization.id, { name, description });
                      forgetMyOrganizations();
                    })
                  }
                  data-testid="organization-save"
                >
                  {busy === "details" ? t("organizations.saving") : t("organizations.save")}
                </Button>
                {organization.setup?.dismissed ? (
                  <Button variant="link" size="sm" className="self-start px-0" onClick={() => void run("setup", () => api.updateOrganization(organization.id, { onboardingDone: false }))} data-testid="organization-setup-show">
                    {t("organizations.setup.bringBack")}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
            <InviteLinksCard
              links={inviteLinks}
              description={t("organizations.inviteLinksDescription")}
              path={(token) => `/join-organization/${token}`}
              onCreate={(data) => api.createOrganizationInviteLink(organization.id, data)}
              onRevoke={(linkId) => api.revokeOrganizationInviteLink(organization.id, linkId)}
              onChanged={() => router.invalidate()}
              onError={setError}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A group of the organisation, that only plans or uses Songverse: for its
 * admins, under another or at the top; for a group's admins, under theirs
 * (`under`, issue #245).
 */
export function NewGroupForm({ organizationId, groups, under, onError }: { organizationId: string; groups: OrganizationTeam[]; under?: { id: string; name: string }; onError: (message: string) => void }) {
  const { api, links } = usePlanning();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [usesSongverse, setUsesSongverse] = useState(false);
  const [parentId, setParentId] = useState(under?.id ?? "");
  const [creating, setCreating] = useState(false);

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)} data-testid="organization-new-group">
        {under ? t("organizations.newSubGroup") : t("organizations.newGroup")}
      </Button>
    );
  }

  async function create() {
    setCreating(true);
    try {
      const group = await api.createOrganizationGroup(organizationId, { name, usesSongverse, ...(parentId ? { parentId } : {}) });
      await navigate({ to: links.team(group.id) });
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
      {under ? (
        <p className="text-sm text-muted-foreground">{t("organizations.subGroupOf", { name: under.name })}</p>
      ) : (
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
      )}
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
