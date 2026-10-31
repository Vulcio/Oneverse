import { Injectable } from "@nestjs/common";
import { BINNED_TOO, type Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

type Tx = Prisma.TransactionClient;

export class TransferUnavailableError extends Error {
  constructor() {
    super("This transfer link is invalid, expired, or already used.");
  }
}

// Large accounts touch many rows; Prisma's 5s default is too tight.
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

/**
 * Permanently removes accounts. Two ways to handle what the user
 * personally owns (song versions, arrangements, songbooks, tags, sets -
 * never team-owned content):
 * - deleteAccountAndContent: everything goes with them.
 * - transferContentAndDeleteAccount: everything moves to another user
 *   first (see ContentTransfersService).
 *
 * Either way, activity tied to the person rather than to owned content
 * (notes, submissions, change proposals, share links, access grants they
 * created) is removed, audit entries lose their actor, and contributor
 * credits keep their name as plain text.
 */
@Injectable()
export class UserDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async deleteAccountAndContent(userId: string): Promise<void> {
    const releasedKeys = await this.prisma.client.$transaction(async (tx) => {
      const contentKeys = await this.purgeOwnedContent(tx, userId);
      const accountKeys = await this.removeAccount(tx, userId);
      return [...contentKeys, ...accountKeys];
    }, TRANSACTION_OPTIONS);
    await this.storage.deleteUnreferenced(releasedKeys);
  }

  /**
   * `consumeTransferId`, when given, is deleted in the same transaction and
   * the whole move aborts if it's already gone - so two people opening the
   * same link at once can't both claim it.
   */
  async transferContentAndDeleteAccount(
    fromUserId: string,
    toUserId: string,
    { consumeTransferId }: { consumeTransferId?: string } = {},
  ): Promise<void> {
    const releasedKeys = await this.prisma.client.$transaction(async (tx) => {
      if (consumeTransferId) {
        const consumed = await tx.contentTransfer.deleteMany({ where: { id: consumeTransferId, expiresAt: { gt: new Date() } } });
        if (consumed.count === 0) throw new TransferUnavailableError();
      }
      const byOwner = { ownerUserId: fromUserId };
      const toOwner = { ownerUserId: toUserId };
      await tx.songVersion.updateMany({ where: byOwner, data: toOwner });
      await tx.arrangement.updateMany({ where: byOwner, data: toOwner });
      // A songbook they'd shared with the new owner is now theirs (issue #211).
      await tx.songbookShare.deleteMany({ where: { userId: toUserId, songbook: byOwner } });
      await tx.songbook.updateMany({ where: byOwner, data: toOwner });
      await tx.tag.updateMany({ where: byOwner, data: toOwner });
      await tx.setlist.updateMany({ where: byOwner, data: toOwner });
      // Their songs shared into team sets stay shared, now by the new owner.
      await tx.setlistItem.updateMany({ where: { sharedByUserId: fromUserId }, data: { sharedByUserId: toUserId } });
      // No point being a guest of a set you now own.
      await tx.setlistGuest.deleteMany({ where: { userId: toUserId, setlist: toOwner } });
      // Their songs' submissions to the global catalogue follow the songs.
      // Songs they put in the catalogue (moved there, issue #73) are credited to the new owner, submissions too.
      await tx.submission.updateMany({
        where: { submitterId: fromUserId, songVersion: { OR: [{ ownerUserId: toUserId }, { contributedByUserId: fromUserId }] } },
        data: { submitterId: toUserId },
      });
      await tx.songVersion.updateMany({ where: { contributedByUserId: fromUserId }, data: { contributedByUserId: toUserId } });
      // Their songs stay shared with the people they shared them with (#77), now by the new owner.
      await tx.accessGrant.deleteMany({ where: { grantedByUserId: fromUserId, grantedToUserId: toUserId } });
      await tx.accessGrant.updateMany({ where: { grantedByUserId: fromUserId }, data: { grantedByUserId: toUserId } });
      // The new owner's storage limit now covers these files.
      await tx.attachment.updateMany({ where: { uploadedByUserId: fromUserId }, data: { uploadedByUserId: toUserId } });
      // Their reference recordings (issue #346) follow the songs too.
      await tx.songLink.updateMany({ where: { addedByUserId: fromUserId }, data: { addedByUserId: toUserId } });
      return this.removeAccount(tx, fromUserId);
    }, TRANSACTION_OPTIONS);
    await this.storage.deleteUnreferenced(releasedKeys);
  }

  /**
   * Makes sure no team is left without an admin once `userId` leaves it,
   * by promoting its longest-standing remaining member.
   */
  async handOverTeamAdminRoles(tx: Tx, userId: string): Promise<void> {
    const adminships = await tx.teamMembership.findMany({ where: { userId, role: "ADMIN" }, select: { teamId: true } });
    for (const { teamId } of adminships) {
      const otherAdmins = await tx.teamMembership.count({ where: { teamId, role: "ADMIN", NOT: { userId } } });
      if (otherAdmins > 0) continue;
      const successor = await tx.teamMembership.findFirst({
        where: { teamId, NOT: { userId } },
        orderBy: { joinedAt: "asc" },
      });
      if (successor) {
        await tx.teamMembership.update({ where: { id: successor.id }, data: { role: "ADMIN" } });
      }
    }
  }

  /** Deletes everything the user personally owns. Returns storage keys that may now be unreferenced. */
  private async purgeOwnedContent(tx: Tx, userId: string): Promise<string[]> {
    const versions = await tx.songVersion.findMany({ where: { ownerUserId: userId, ...BINNED_TOO }, select: { id: true, workId: true, imageStorageKey: true } });
    const versionIds = versions.map((version) => version.id);
    const workIds = [...new Set(versions.map((version) => version.workId))];

    const attachments = await tx.attachment.findMany({
      where: { songVersionId: { in: versionIds } },
      select: { storageKey: true, originalStorageKey: true },
    });
    // Their private files on other people's songs (issue #72) would have no
    // one left to see them: they go too. Files they shared stay.
    const privateFiles = await tx.attachment.findMany({
      where: { uploadedByUserId: userId, visibility: "PRIVATE", songVersionId: { notIn: versionIds } },
      select: { id: true, storageKey: true, originalStorageKey: true },
    });
    await tx.attachment.deleteMany({ where: { id: { in: privateFiles.map((file) => file.id) } } });
    // So do their private reference recordings (issue #346).
    await tx.songLink.deleteMany({ where: { addedByUserId: userId, visibility: "PRIVATE" } });

    // Arrangements they own, plus any arrangement (anyone's) of a version
    // that's about to disappear - an arrangement can't outlive its version.
    const arrangements = await tx.arrangement.findMany({
      where: { OR: [{ ownerUserId: userId }, { songVersionId: { in: versionIds } }] },
      select: { id: true },
    });
    const arrangementIds = arrangements.map((arrangement) => arrangement.id);

    // Setlist entries for a deleted song go; entries that only lose an
    // arrangement keep their song.
    await tx.setlistItem.deleteMany({ where: { songVersionId: { in: versionIds } } });
    await tx.setlistItem.updateMany({ where: { arrangementId: { in: arrangementIds } }, data: { arrangementId: null } });
    await tx.arrangement.deleteMany({ where: { id: { in: arrangementIds } } });

    // References without ON DELETE CASCADE.
    await tx.work.updateMany({
      where: { preferredOriginalVersionId: { in: versionIds } },
      data: { preferredOriginalVersionId: null },
    });
    await tx.songVersion.updateMany({ where: { parentVersionId: { in: versionIds } }, data: { parentVersionId: null } });
    await tx.submission.deleteMany({ where: { songVersionId: { in: versionIds } } });
    await tx.changeProposal.deleteMany({ where: { songVersionId: { in: versionIds } } });
    await tx.auditEvent.updateMany({ where: { songVersionId: { in: versionIds } }, data: { songVersionId: null } });

    await tx.songVersion.deleteMany({ where: { id: { in: versionIds } } });
    // A Work has no content of its own - drop the ones left with no versions.
    await tx.work.deleteMany({ where: { id: { in: workIds }, versions: { none: {} } } });

    // Their songbooks' pictures go with them (issue #161).
    const songbookPictures = await tx.songbook.findMany({ where: { ownerUserId: userId, avatarStorageKey: { not: null } }, select: { avatarStorageKey: true } });
    await tx.songbook.deleteMany({ where: { ownerUserId: userId } });
    await tx.tag.deleteMany({ where: { ownerUserId: userId } });
    await tx.setlist.deleteMany({ where: { ownerUserId: userId } });

    return [
      ...[...attachments, ...privateFiles].flatMap((attachment) => (attachment.originalStorageKey ? [attachment.storageKey, attachment.originalStorageKey] : [attachment.storageKey])),
      // Their songs' images (issue #85).
      ...versions.flatMap((version) => (version.imageStorageKey ? [version.imageStorageKey] : [])),
      ...songbookPictures.flatMap((songbook) => (songbook.avatarStorageKey ? [songbook.avatarStorageKey] : [])),
    ];
  }

  /** Removes the user row and personal activity. Returns the keys of their avatar and screen themes' files, for storage cleanup. */
  private async removeAccount(tx: Tx, userId: string): Promise<string[]> {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true, avatarStorageKey: true } });

    await tx.noteReply.deleteMany({ where: { authorUserId: userId } });
    await tx.note.deleteMany({ where: { authorUserId: userId } });
    await tx.submission.deleteMany({ where: { submitterId: userId } });
    await tx.changeProposal.deleteMany({ where: { proposerId: userId } });
    await tx.accessGrant.deleteMany({ where: { OR: [{ grantedByUserId: userId }, { grantedToUserId: userId }] } });
    await tx.auditEvent.updateMany({ where: { actorUserId: userId }, data: { actorUserId: null } });

    // Credits survive as plain text: name-only when there was no text source.
    await tx.versionContributor.updateMany({
      where: { userId, source: null },
      data: { userId: null, source: user.displayName },
    });
    await tx.versionContributor.updateMany({ where: { userId }, data: { userId: null } });

    await this.handOverTeamAdminRoles(tx, userId);
    // Their own screen templates and parts go with them (issues #194, #281, cascading), and their files with those.
    const themeFiles = await tx.screenThemeAsset.findMany({ where: { OR: [{ theme: { ownerUserId: userId } }, { part: { ownerUserId: userId } }] }, select: { storageKey: true } });
    // Sessions, accounts, passkeys, memberships, a pending ContentTransfer,
    // screens and screen themes and other per-user rows cascade;
    // Attachment.uploadedByUserId nulls.
    await tx.user.delete({ where: { id: userId } });

    return [...(user.avatarStorageKey ? [user.avatarStorageKey] : []), ...themeFiles.map((file) => file.storageKey)];
  }
}
