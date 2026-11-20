import type { AnnouncementAudience } from "@oneverse/core";
import type { Prisma, PrismaClient } from "@oneverse/db";

/** What decides who gets an announcement. */
export interface AnnouncementScope {
  audience: string;
  organizationId: string | null;
  teamIds: string[];
  withSubgroups: boolean;
}

/** The teams, and with `withSubgroups` the groups under them, all the way down. */
export async function teamsWithSubgroups(prisma: Pick<PrismaClient, "team">, teamIds: string[], withSubgroups: boolean): Promise<string[]> {
  const all = new Set(teamIds);
  let level = teamIds;
  while (withSubgroups && level.length > 0) {
    const children = await prisma.team.findMany({ where: { parentId: { in: level } }, select: { id: true } });
    level = children.map((child) => child.id).filter((id) => !all.has(id));
    for (const id of level) all.add(id);
  }
  return [...all];
}

/**
 * Who an announcement goes to (issue #536), never banned or deleted accounts:
 * - EVERYONE: every account;
 * - SONGVERSE: everyone but people whose only teams are groups that only plan;
 * - PLANIVERSE: people in an organisation;
 * - ORGANIZATION: its members;
 * - TEAMS: the members of its teams (and of the groups under them), each once.
 */
export async function announcementRecipients(prisma: Pick<PrismaClient, "team">, scope: AnnouncementScope): Promise<Prisma.UserWhereInput> {
  const base: Prisma.UserWhereInput = { bannedAt: null, deletedAt: null };
  switch (scope.audience as AnnouncementAudience) {
    case "SONGVERSE":
      return { ...base, NOT: { teamMemberships: { some: {}, every: { team: { usesSongverse: false } } } } };
    case "PLANIVERSE":
      return { ...base, organizationMemberships: { some: {} } };
    case "ORGANIZATION":
      // No organisation, nobody: never everyone by mistake.
      return { ...base, organizationMemberships: { some: { organizationId: scope.organizationId ?? "-" } } };
    case "TEAMS":
      return { ...base, teamMemberships: { some: { teamId: { in: await teamsWithSubgroups(prisma, scope.teamIds, scope.withSubgroups) } } } };
    default:
      return base;
  }
}

/** Who it's from, as its notifications name it: the organisation, or the team. */
export function announcementFrom(row: { organization?: { name: string } | null; team?: { name: string } | null }): { organization?: string; team?: string } {
  return { ...(row.organization ? { organization: row.organization.name } : {}), ...(row.team ? { team: row.team.name } : {}) };
}

/** Its notifications' kind: a team's admins', an organisation's, or the server's. */
export function announcementKind(row: { teamId: string | null; organizationId: string | null }): "TEAM_ANNOUNCEMENT" | "ORGANIZATION_ANNOUNCEMENT" | "ANNOUNCEMENT" {
  return row.teamId ? "TEAM_ANNOUNCEMENT" : row.organizationId ? "ORGANIZATION_ANNOUNCEMENT" : "ANNOUNCEMENT";
}

/** The web app its notifications belong to (issue #241): Planiverse's for organisations' people and groups that only plan, Songverse's otherwise. */
export function announcementApp(row: { audience: string; organizationId: string | null; team?: { usesSongverse: boolean } | null }): "planiverse" | null {
  if (row.team) return row.team.usesSongverse ? null : "planiverse";
  return row.audience === "PLANIVERSE" || row.organizationId ? "planiverse" : null;
}
