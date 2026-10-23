import type { PrismaClient } from "@oneverse/db";

/**
 * What someone may do beyond their own and their teams' songs (issue #160),
 * from their roles and their teams' roles: any role that allows something
 * allows it, and the largest limit wins. Global admins can do everything.
 * Resolved fresh on every use, like the settings singletons.
 */
export interface Capabilities {
  canReview: boolean;
  canSeparateStems: boolean;
  /** Lossless audio uploads keep their original, as FLAC (issue #182). */
  canKeepLosslessAudio: boolean;
  /** Uploads audio files (issue #183): without it, only what's recorded in Songverse. */
  canUploadAudio: boolean;
  /** Controls what's presented on the screens of the sets they can open (issue #305), beside the set's leader. */
  canOperateScreens: boolean;
  /** Moves the screens of the sets they can open to the next or previous song or section (issue #322). */
  canCue: boolean;
  /** Pairs, changes and disconnects the screens of their teams and organisations (issue #322), without being their admin. */
  canManageScreens: boolean;
  /** Each separating role's monthly limit; null: the one set in Admin > Stem separation. See monthlyLimitOf. */
  stemSeparationMonthlyLimits: (number | null)[];
  /** Their own storage limit; null: the default one. */
  storageLimitMb: number | null;
  /** Granted to plugins later (issue #157). */
  permissions: string[];
  /** Their roles, their own and their teams'. */
  roleIds: string[];
}

type RoleRow = {
  id: string;
  canReview: boolean;
  canSeparateStems: boolean;
  canKeepLosslessAudio: boolean;
  canUploadAudio: boolean;
  canOperateScreens: boolean;
  canCue: boolean;
  canManageScreens: boolean;
  stemSeparationMonthlyLimit: number | null;
  storageLimitMb: number | null;
  permissions: string[];
};

const ROLE_FIELDS = {
  id: true,
  canReview: true,
  canSeparateStems: true,
  canKeepLosslessAudio: true,
  canUploadAudio: true,
  canOperateScreens: true,
  canCue: true,
  canManageScreens: true,
  stemSeparationMonthlyLimit: true,
  storageLimitMb: true,
  permissions: true,
} as const;

/** The largest of the limits set; null when none is. */
function largest(values: (number | null)[]): number | null {
  const set = values.filter((value): value is number => value !== null);
  return set.length ? Math.max(...set) : null;
}

export function combineRoles(roles: RoleRow[]): Capabilities {
  const separating = roles.filter((role) => role.canSeparateStems);
  return {
    canReview: roles.some((role) => role.canReview),
    canSeparateStems: separating.length > 0,
    canKeepLosslessAudio: roles.some((role) => role.canKeepLosslessAudio),
    canUploadAudio: roles.some((role) => role.canUploadAudio),
    canOperateScreens: roles.some((role) => role.canOperateScreens),
    canCue: roles.some((role) => role.canCue),
    canManageScreens: roles.some((role) => role.canManageScreens),
    stemSeparationMonthlyLimits: separating.map((role) => role.stemSeparationMonthlyLimit),
    storageLimitMb: largest(roles.map((role) => role.storageLimitMb)),
    permissions: [...new Set(roles.flatMap((role) => role.permissions))].sort(),
    roleIds: roles.map((role) => role.id),
  };
}

/**
 * Separations a month someone may start: the largest their roles allow, a
 * role without its own limit counting as the default (`defaultLimit`, null
 * for none). Null: no limit.
 */
export function monthlyLimitOf(capabilities: Capabilities, defaultLimit: number | null): number | null {
  const limits = capabilities.stemSeparationMonthlyLimits.map((limit) => limit ?? defaultLimit);
  if (limits.length === 0) return defaultLimit;
  return limits.includes(null) ? null : Math.max(...(limits as number[]));
}

/** A user's roles: their own, and those of every team they're a member of - those given everywhere, not on one team or organisation. */
export async function capabilitiesOf(prisma: PrismaClient, userId: string): Promise<Capabilities> {
  const roles = await prisma.role.findMany({
    where: { assignments: { some: { scopeKey: "", OR: [{ userId }, { team: { memberships: { some: { userId } } } }] } } },
    select: ROLE_FIELDS,
    orderBy: { name: "asc" },
  });
  return combineRoles(roles);
}

/**
 * What a user may do on one team's things - its sets, its screens (issue
 * #270): their roles everywhere, and those given them on that team or its
 * organisation. A role given there counts for what makes sense there only:
 * running screens, cueing them (managing them: see `screenManagerScope`). Storage, uploads, review and stem separation stay the
 * roles given everywhere.
 */
export async function capabilitiesIn(prisma: PrismaClient, userId: string, teamId: string | null): Promise<Capabilities> {
  const everywhere = await capabilitiesOf(prisma, userId);
  if (!teamId) return everywhere;
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { organizationId: true } });
  if (!team) return everywhere;
  const scoped = await prisma.role.findMany({
    where: { teamAssignable: true, assignments: { some: { userId, OR: [{ scopeTeamId: teamId }, ...(team.organizationId ? [{ scopeOrganizationId: team.organizationId }] : [])] } } },
    select: { id: true, canOperateScreens: true, canCue: true },
  });
  return {
    ...everywhere,
    canOperateScreens: everywhere.canOperateScreens || scoped.some((role) => role.canOperateScreens),
    canCue: everywhere.canCue || scoped.some((role) => role.canCue),
  };
}

/**
 * Where a user manages screens by a role (issue #322): every team and
 * organisation they're in, from a role given everywhere; the team or the
 * organisation (and its teams) a team-assignable role was given them on.
 */
export async function screenManagerScope(prisma: PrismaClient, userId: string, memberOf: { teams: Set<string>; organizations: Set<string> }): Promise<{ teams: Set<string>; organizations: Set<string> }> {
  if ((await capabilitiesOf(prisma, userId)).canManageScreens) return { teams: new Set(memberOf.teams), organizations: new Set(memberOf.organizations) };
  const given = await prisma.roleAssignment.findMany({
    where: { userId, scopeKey: { not: "" }, role: { teamAssignable: true, canManageScreens: true } },
    select: { scopeTeamId: true, scopeOrganizationId: true },
  });
  const organizations = new Set(given.flatMap((one) => (one.scopeOrganizationId ? [one.scopeOrganizationId] : [])));
  const teams = new Set(given.flatMap((one) => (one.scopeTeamId ? [one.scopeTeamId] : [])));
  if (organizations.size) for (const team of await prisma.team.findMany({ where: { organizationId: { in: [...organizations] } }, select: { id: true } })) teams.add(team.id);
  return { teams, organizations };
}

/** A team's own roles: what its pool may hold. */
export async function teamStorageLimitMb(prisma: PrismaClient, teamId: string): Promise<number | null> {
  const roles = await prisma.role.findMany({ where: { assignments: { some: { teamId, scopeKey: "" } } }, select: { storageLimitMb: true } });
  return largest(roles.map((role) => role.storageLimitMb));
}
