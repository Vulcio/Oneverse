import type { AnnouncementAudience } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";

/**
 * Who an announcement goes to (issue #536), never banned or deleted accounts:
 * - EVERYONE: every account;
 * - SONGVERSE: everyone but people whose only teams are groups that only plan;
 * - PLANIVERSE: people in an organisation;
 * - ORGANIZATION: its members.
 */
export function announcementRecipients(announcement: { audience: string; organizationId: string | null }): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = { bannedAt: null, deletedAt: null };
  switch (announcement.audience as AnnouncementAudience) {
    case "SONGVERSE":
      return { ...base, NOT: { teamMemberships: { some: {}, every: { team: { usesSongverse: false } } } } };
    case "PLANIVERSE":
      return { ...base, organizationMemberships: { some: {} } };
    case "ORGANIZATION":
      // No organisation, nobody: never everyone by mistake.
      return { ...base, organizationMemberships: { some: { organizationId: announcement.organizationId ?? "-" } } };
    default:
      return base;
  }
}

/** The web app its notifications belong to (issue #241): Planiverse's for organisations' people, Songverse's otherwise. */
export function announcementApp(audience: string): "planiverse" | null {
  return audience === "PLANIVERSE" || audience === "ORGANIZATION" ? "planiverse" : null;
}
