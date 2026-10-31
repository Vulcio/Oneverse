import type { Prisma } from "@oneverse/db";

/**
 * Someone out of teams (issue #340), however they leave: removed by an admin,
 * leaving on their own, or out of the teams' organisation. Their memberships
 * go, and with them their places from today on in those teams' line-ups and
 * their answers for those dates, so nobody is counted on who's no longer
 * there. What's past stays, as a record. Run inside the caller's transaction.
 */
export async function leaveTeams(tx: Prisma.TransactionClient, userId: string, teamIds: string[]): Promise<void> {
  if (teamIds.length === 0) return;
  const today = new Date(new Date().toISOString().slice(0, 10));
  const future = { userId, date: { gte: today }, event: { teamId: { in: teamIds } } };
  await tx.teamEventAssignment.deleteMany({ where: future });
  await tx.teamEventAnswer.deleteMany({ where: future });
  await tx.teamMembership.deleteMany({ where: { userId, teamId: { in: teamIds } } });
}
