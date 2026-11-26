import type { Prisma } from "@oneverse/db";

/**
 * Bookings that wait for approval (issue #565): a room or resource marked
 * `needsApproval` is booked by an event as a request, holding the slot,
 * until one of its managers approves it - the admins of its manager team if
 * it has one, else its owner's admins. A manager's own event needs no
 * approval. An organisation's event asks once for all its groups.
 */

type Db = Prisma.TransactionClient;
export type BookingRef = { teamEventId: string } | { organizationEventId: string };

const MANAGED = { needsApproval: true, managerTeamId: true } as const;
const ROOM_MANAGED = { id: true, ...MANAGED, location: { select: { ownerTeamId: true, ownerOrganizationId: true } } } as const;
const RESOURCE_MANAGED = { id: true, ...MANAGED, ownerTeamId: true, ownerOrganizationId: true } as const;

/** An event's approvals, as its summary shows those still waiting. */
export const AWAITING_APPROVAL = { bookingApprovals: { select: { status: true, room: { select: { name: true } }, resource: { select: { name: true } } } } } as const;

/** The names of the rooms and resources whose booking still waits for approval. */
export const awaitingApproval = (rows: { status: string; room: { name: string } | null; resource: { name: string } | null }[]) =>
  rows.filter((row) => row.status === "REQUESTED").map((row) => row.room?.name ?? row.resource?.name ?? "").sort();

/** Whose approval a room or resource waits for: its manager team, else its owner (a team or an organisation). */
export interface Managed {
  managerTeamId: string | null;
  ownerTeamId: string | null;
  ownerOrganizationId: string | null;
}

/** The people who approve a room's or resource's bookings: its manager team's admins, else its owner's admins. */
export async function managersOf(db: Db, managed: Managed): Promise<string[]> {
  if (managed.managerTeamId || managed.ownerTeamId) {
    const rows = await db.teamMembership.findMany({ where: { teamId: (managed.managerTeamId ?? managed.ownerTeamId)!, role: "ADMIN" }, select: { userId: true } });
    return rows.map((row) => row.userId);
  }
  if (!managed.ownerOrganizationId) return [];
  const rows = await db.organizationMembership.findMany({ where: { organizationId: managed.ownerOrganizationId, role: "ADMIN" }, select: { userId: true } });
  return rows.map((row) => row.userId);
}

/** The approvals' where for an event. */
export const approvalsOf = (ref: BookingRef) => ("teamEventId" in ref ? { teamEventId: ref.teamEventId } : { organizationEventId: ref.organizationEventId });

/**
 * Its approvals made to follow what an event takes, inside the change's
 * transaction: those of rooms and resources it no longer takes go, and each
 * one it now takes that needs approval is asked for - approved at once when
 * `userId` manages it. Answers the new requests, for their managers to be
 * told once the change is saved.
 */
export async function syncApprovals(db: Db, ref: BookingRef, userId: string | null): Promise<string[]> {
  const event =
    "teamEventId" in ref
      ? await db.teamEvent.findUnique({ where: { id: ref.teamEventId }, select: { rooms: { select: ROOM_MANAGED }, resources: { select: { resource: { select: RESOURCE_MANAGED } } } } })
      : await db.organizationEvent.findUnique({ where: { id: ref.organizationEventId }, select: { rooms: { select: ROOM_MANAGED }, resources: { select: { resource: { select: RESOURCE_MANAGED } } } } });
  if (!event) return [];
  const taken = [
    ...event.rooms.map((room) => ({ roomId: room.id, resourceId: null, needsApproval: room.needsApproval, managed: { managerTeamId: room.managerTeamId, ownerTeamId: room.location.ownerTeamId, ownerOrganizationId: room.location.ownerOrganizationId } })),
    ...event.resources.map(({ resource }) => ({ roomId: null, resourceId: resource.id, needsApproval: resource.needsApproval, managed: { managerTeamId: resource.managerTeamId, ownerTeamId: resource.ownerTeamId, ownerOrganizationId: resource.ownerOrganizationId } })),
  ];
  const where = approvalsOf(ref);
  const existing = await db.bookingApproval.findMany({ where, select: { id: true, roomId: true, resourceId: true } });
  const wanted = taken.filter((one) => one.needsApproval);
  const gone = existing.filter((row) => !wanted.some((one) => (row.roomId ? one.roomId === row.roomId : one.resourceId === row.resourceId)));
  if (gone.length > 0) await db.bookingApproval.deleteMany({ where: { id: { in: gone.map((row) => row.id) } } });
  const requested: string[] = [];
  for (const one of wanted) {
    if (existing.some((row) => (one.roomId ? row.roomId === one.roomId : row.resourceId === one.resourceId))) continue;
    const approved = !!userId && (await managersOf(db, one.managed)).includes(userId);
    const row = await db.bookingApproval.create({
      data: { ...where, roomId: one.roomId, resourceId: one.resourceId, status: approved ? "APPROVED" : "REQUESTED", requestedByUserId: userId, ...(approved ? { decidedByUserId: userId, decidedAt: new Date() } : {}) },
      select: { id: true },
    });
    if (!approved) requested.push(row.id);
  }
  return requested;
}
