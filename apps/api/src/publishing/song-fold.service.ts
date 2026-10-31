import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import {
  arrangementFromChart,
  generateId,
  ID_PREFIXES,
  mapChartIds,
  mapFlowIds,
  NoteAnchorSchema,
  remapNoteAnchor,
  newArrangementDocument,
  readSongDocument,
  remapArrangement,
  safeParseArrangementDocumentV2,
  snapshotChanges,
  type SongSnapshot,
} from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { SongHistoryService } from "../song-versions/song-history.service.js";

type Tx = Prisma.TransactionClient;

/** One fold at a time, whichever process runs it. */
const FOLD_LOCK = 7_502_075;

/**
 * Folds a song into a catalogue song it duplicates (issue #75), so there's
 * one song rather than a copy: a song published as a copy before #73, or
 * one merged into a duplicate at review.
 *
 * Everything on it moves to the catalogue song - its arrangements (pointed
 * at the catalogue song's sections, lines and chords, by ID or by content),
 * files (kept to its owner, or its team), tags, set and songbook entries,
 * offline pins, chart settings, notes, submissions, the versions derived
 * from it - and how its owner had it becomes their arrangement of the
 * catalogue song (with its own notes as the description). Details and
 * credits that differ become a suggestion (#74) from its owner. Then it's
 * deleted, with its history.
 */
@Injectable()
export class SongFoldService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SongFoldService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly history: SongHistoryService,
  ) {}

  /** Songs published as copies before #73 (each with an UpstreamLink) are folded into their catalogue song, once. */
  async onApplicationBootstrap(): Promise<void> {
    await this.foldCopies();
  }

  /** Folds every song still linked to a catalogue copy of it; how many were. */
  async foldCopies(): Promise<number> {
    let folded = 0;
    const links = await this.prisma.client.upstreamLink.findMany({
      where: { localVersion: { ownerScope: { not: "GLOBAL" } }, globalVersion: { ownerScope: "GLOBAL" } },
      select: { localVersionId: true, globalVersionId: true },
    });
    for (const link of links) {
      try {
        await this.prisma.client.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FOLD_LOCK})`;
            // Another process may have folded it meanwhile.
            const still = await tx.upstreamLink.count({ where: { localVersionId: link.localVersionId, globalVersionId: link.globalVersionId } });
            if (still > 0) await this.fold(tx, link.localVersionId, link.globalVersionId, null);
          },
          { timeout: 60_000 },
        );
        folded++;
        this.logger.log(`Folded ${link.localVersionId} into ${link.globalVersionId}`);
      } catch (error) {
        this.logger.error(`Couldn't fold ${link.localVersionId} into ${link.globalVersionId}: ${String(error)}`);
      }
    }
    return folded;
  }

  /**
   * Folds `songId` into `targetId`, in `tx`. `proposerId` suggests its
   * details and credits where they differ (its owner, if a person, when
   * left out).
   */
  async fold(tx: Tx, songId: string, targetId: string, proposerId: string | null): Promise<{ arrangementId: string | null }> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FOLD_LOCK})`;
    const song = await tx.songVersion.findUniqueOrThrow({
      where: { id: songId },
      select: {
        id: true,
        workId: true,
        title: true,
        versionName: true,
        notes: true,
        capo: true,
        documentJson: true,
        ownerScope: true,
        ownerUserId: true,
        ownerTeamId: true,
        ownerUser: { select: { displayName: true, locale: true } },
        ownerTeam: { select: { name: true } },
      },
    });
    const target = await tx.songVersion.findUniqueOrThrow({ where: { id: targetId }, select: { id: true, workId: true, capo: true, documentJson: true } });
    const songDoc = readSongDocument(song.documentJson);
    const targetDoc = readSongDocument(target.documentJson);
    const map = mapChartIds(songDoc, targetDoc);
    const owner = { ownerScope: song.ownerScope, ownerUserId: song.ownerUserId, ownerTeamId: song.ownerTeamId };

    // Its arrangements, pointed at the catalogue song (what doesn't map is left for their owners to review).
    const arrangements = await tx.arrangement.findMany({ where: { songVersionId: songId }, select: { id: true, documentJson: true, isTeamDefault: true, ownerTeamId: true } });
    for (const arrangement of arrangements) {
      const parsed = safeParseArrangementDocumentV2(arrangement.documentJson);
      const teamHasDefault =
        arrangement.isTeamDefault &&
        (await tx.arrangement.count({ where: { songVersionId: targetId, ownerTeamId: arrangement.ownerTeamId, isTeamDefault: true } })) > 0;
      await tx.arrangement.update({
        where: { id: arrangement.id },
        data: {
          songVersionId: targetId,
          ...(parsed.success && { documentJson: remapArrangement(parsed.data, map, targetId) as object }),
          ...(teamHasDefault && { isTeamDefault: false }),
        },
      });
    }

    // How its owner had it: their arrangement of the catalogue song.
    let ownArrangementId: string | null = null;
    const played = arrangementFromChart(songDoc, targetDoc, map, targetId, { capo: song.capo, toCapo: target.capo });
    const notes = song.notes?.trim() || null;
    // (A song with no chart has nothing to play.)
    if ((played || notes) && song.ownerScope !== "GLOBAL" && songDoc.sections.length > 0) {
      const document = played ?? newArrangementDocument(targetDoc, targetId, () => generateId(ID_PREFIXES.arrangementItem));
      const french = song.ownerUser?.locale?.startsWith("fr");
      const name = song.versionName ?? song.ownerTeam?.name ?? (french ? `Version de ${song.ownerUser?.displayName ?? ""}` : `${song.ownerUser?.displayName ?? ""}'s`);
      const teamDefault =
        song.ownerScope === "TEAM" && (await tx.arrangement.count({ where: { songVersionId: targetId, ownerTeamId: song.ownerTeamId, isTeamDefault: true } })) === 0;
      const created = await tx.arrangement.create({
        data: { songVersionId: targetId, ...owner, name: name.trim() || song.title, description: notes, documentJson: document as object, isTeamDefault: teamDefault },
        select: { id: true },
      });
      ownArrangementId = created.id;
    }

    // Its details and credits, where they differ: a suggestion (not its own notes, which stay private).
    const proposer = proposerId ?? song.ownerUserId;
    const [songNow, targetNow] = await Promise.all([this.history.before(tx, songId), this.history.before(tx, targetId)]);
    if (proposer && songNow && targetNow) {
      const proposed: SongSnapshot = {
        ...targetNow.snapshot,
        details: { ...songNow.snapshot.details, notes: targetNow.snapshot.details.notes, versionName: targetNow.snapshot.details.versionName },
        credits: songNow.snapshot.credits,
      };
      if (snapshotChanges(targetNow.snapshot, proposed).length > 0) {
        await tx.changeProposal.create({
          data: {
            songVersionId: targetId,
            proposerId: proposer,
            type: "METADATA_UPDATE",
            title: song.title,
            proposedChange: { $schema: "song-change/v1", base: targetNow.snapshot, proposed } as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    // Files: still its owner's (or team's) only, as publishing does (#73).
    if (song.ownerScope === "TEAM" && song.ownerTeamId) {
      await tx.attachment.updateMany({ where: { songVersionId: songId, visibility: { in: ["SONG", "SHARED"] } }, data: { visibility: "TEAM", visibleToTeamId: song.ownerTeamId } });
    } else {
      await tx.attachment.updateMany({ where: { songVersionId: songId, visibility: { in: ["SONG", "SHARED"] }, uploadedByUserId: null }, data: { uploadedByUserId: song.ownerUserId } });
      await tx.attachment.updateMany({ where: { songVersionId: songId, visibility: { in: ["SONG", "SHARED"] } }, data: { visibility: "PRIVATE" } });
    }
    // Their cue points (issue #110) at the catalogue song's sections; one that doesn't map is dropped.
    const cued = await tx.attachment.findMany({ where: { songVersionId: songId, cuePoints: { not: Prisma.DbNull } }, select: { id: true, cuePoints: true } });
    for (const file of cued) {
      const cues = Array.isArray(file.cuePoints) ? (file.cuePoints as { at: number; sectionId: string }[]) : [];
      const mapped = cues.flatMap((cue) => (map.sections.has(cue.sectionId) ? [{ at: cue.at, sectionId: map.sections.get(cue.sectionId)! }] : []));
      await tx.attachment.update({ where: { id: file.id }, data: { cuePoints: mapped.length ? mapped : Prisma.DbNull } });
    }
    await tx.attachment.updateMany({ where: { songVersionId: songId }, data: { songVersionId: targetId } });
    // Its reference recordings (issue #346) too, kept to their adders as its files are.
    if (song.ownerScope === "TEAM" && song.ownerTeamId) {
      await tx.songLink.updateMany({ where: { songVersionId: songId, visibility: { in: ["SONG", "SHARED"] } }, data: { visibility: "TEAM", visibleToTeamId: song.ownerTeamId } });
    } else {
      await tx.songLink.updateMany({ where: { songVersionId: songId, visibility: { in: ["SONG", "SHARED"] }, addedByUserId: null }, data: { addedByUserId: song.ownerUserId } });
      await tx.songLink.updateMany({ where: { songVersionId: songId, visibility: { in: ["SONG", "SHARED"] } }, data: { visibility: "PRIVATE" } });
    }
    await tx.songLink.updateMany({ where: { songVersionId: songId }, data: { songVersionId: targetId } });
    // Its stem separations follow the files they made (issue #63): an HQ pass still to come lands in the song they're in now.
    await tx.stemSeparation.updateMany({ where: { songVersionId: songId }, data: { songVersionId: targetId } });

    // Its image (#85), when the catalogue song has none: the same bytes stay stored either way.
    await tx.$executeRaw`
      UPDATE "SongVersion" AS target SET "imageStorageKey" = source."imageStorageKey", "imageSourceUrl" = source."imageSourceUrl"
      FROM "SongVersion" AS source
      WHERE target.id = ${targetId} AND source.id = ${songId} AND target."imageStorageKey" IS NULL AND source."imageStorageKey" IS NOT NULL`;

    // People's favorites and views of it (#81) are of the catalogue song now; both for one person merge.
    await tx.$executeRaw`
      INSERT INTO "FavoriteSong" ("userId", "songVersionId", "createdAt")
      SELECT "userId", ${targetId}, "createdAt" FROM "FavoriteSong" WHERE "songVersionId" = ${songId}
      ON CONFLICT ("userId", "songVersionId") DO NOTHING`;
    // And their Quick selections (issue #334).
    await tx.$executeRaw`
      INSERT INTO "QuickSelectionSong" ("userId", "songVersionId", "addedAt")
      SELECT "userId", ${targetId}, "addedAt" FROM "QuickSelectionSong" WHERE "songVersionId" = ${songId}
      ON CONFLICT ("userId", "songVersionId") DO NOTHING`;
    await tx.$executeRaw`
      INSERT INTO "SongView" ("userId", "songVersionId", "viewedAt", "count")
      SELECT "userId", ${targetId}, "viewedAt", "count" FROM "SongView" WHERE "songVersionId" = ${songId}
      ON CONFLICT ("userId", "songVersionId") DO UPDATE
        SET "viewedAt" = GREATEST("SongView"."viewedAt", EXCLUDED."viewedAt"), "count" = "SongView"."count" + EXCLUDED."count"`;

    // Tags it has that the catalogue song doesn't.
    const tags = await tx.songVersionTag.findMany({ where: { songVersionId: songId }, select: { tagId: true } });
    await tx.songVersionTag.createMany({ data: tags.map(({ tagId }) => ({ songVersionId: targetId, tagId })), skipDuplicates: true });

    // Sets: its owner's own sets play their arrangement where they played the song as written.
    if (ownArrangementId) {
      await tx.setlistItem.updateMany({
        where: {
          songVersionId: songId,
          arrangementId: null,
          setlist: song.ownerScope === "TEAM" ? { ownerTeamId: song.ownerTeamId } : { ownerUserId: song.ownerUserId },
        },
        data: { arrangementId: ownArrangementId },
      });
    }
    await tx.setlistItem.updateMany({ where: { songVersionId: songId }, data: { songVersionId: targetId } });

    // Songbooks: one entry per song and songbook.
    for (const entry of await tx.songbookEntry.findMany({ where: { songVersionId: songId }, select: { id: true, songbookId: true } })) {
      const there = await tx.songbookEntry.count({ where: { songVersionId: targetId, songbookId: entry.songbookId } });
      if (there > 0) await tx.songbookEntry.delete({ where: { id: entry.id } });
      else await tx.songbookEntry.update({ where: { id: entry.id }, data: { songVersionId: targetId } });
    }

    // Offline pins: one per user and song.
    for (const pin of await tx.offlinePin.findMany({ where: { kind: "SONG", targetId: songId }, select: { id: true, userId: true } })) {
      const there = await tx.offlinePin.count({ where: { userId: pin.userId, kind: "SONG", targetId } });
      if (there > 0) await tx.offlinePin.delete({ where: { id: pin.id } });
      else await tx.offlinePin.update({ where: { id: pin.id }, data: { targetId } });
    }

    // Chart settings: an arrangement's follow it; the song-as-written ones go to its owner's arrangement, or the song.
    // Players' chosen chord shapes (issue #207) follow, unless they already chose one for that chord there.
    for (const choice of await tx.chordShapeChoice.findMany({ where: { songVersionId: songId } })) {
      const there = await tx.chordShapeChoice.count({
        where: { userId: choice.userId, songVersionId: targetId, instrument: choice.instrument, tuning: choice.tuning, chord: choice.chord },
      });
      if (there > 0) await tx.chordShapeChoice.delete({ where: { id: choice.id } });
      else await tx.chordShapeChoice.update({ where: { id: choice.id }, data: { songVersionId: targetId } });
    }
    await tx.chartPreference.updateMany({ where: { songVersionId: songId, arrangementId: { not: null } }, data: { songVersionId: targetId } });
    for (const preference of await tx.chartPreference.findMany({ where: { songVersionId: songId, arrangementKey: "" }, select: { id: true, userId: true } })) {
      const key = ownArrangementId ?? "";
      const there = await tx.chartPreference.count({ where: { userId: preference.userId, songVersionId: targetId, arrangementKey: key } });
      if (there > 0) await tx.chartPreference.delete({ where: { id: preference.id } });
      else await tx.chartPreference.update({ where: { id: preference.id }, data: { songVersionId: targetId, arrangementKey: key, arrangementId: ownArrangementId } });
    }

    // Notes (issue #256): pinned to the same places in the catalogue song; what has no match there moves up.
    const flowMap = mapFlowIds(songDoc, targetDoc, map);
    for (const note of await tx.note.findMany({ where: { songVersionId: songId }, select: { id: true, anchor: true } })) {
      const anchor = NoteAnchorSchema.safeParse(note.anchor);
      await tx.note.update({
        where: { id: note.id },
        data: { songVersionId: targetId, anchor: anchor.success ? remapNoteAnchor(anchor.data, map, flowMap) : { kind: "song" } },
      });
    }
    await tx.submission.updateMany({ where: { songVersionId: songId }, data: { songVersionId: targetId } });
    await tx.changeProposal.updateMany({ where: { songVersionId: songId }, data: { songVersionId: targetId } });

    // Versions derived from it (a translation) now derive from the catalogue song, in its Work.
    await tx.songVersion.updateMany({ where: { parentVersionId: songId }, data: { parentVersionId: targetId } });
    if (song.workId !== target.workId) {
      await tx.songVersion.updateMany({ where: { workId: song.workId, NOT: { id: songId } }, data: { workId: target.workId } });
    }

    // References that don't cascade, then the song, and its Work if nothing's left in it.
    await tx.work.updateMany({ where: { preferredOriginalVersionId: songId }, data: { preferredOriginalVersionId: null } });
    await tx.importJob.updateMany({ where: { draftVersionId: songId }, data: { draftVersionId: null } });
    await tx.auditEvent.updateMany({ where: { songVersionId: songId }, data: { songVersionId: targetId } });
    await tx.songVersion.delete({ where: { id: songId } });
    await tx.work.deleteMany({ where: { id: song.workId, versions: { none: {} } } });
    await tx.auditEvent.create({
      data: { action: "UPDATED", entityType: "SongVersion", entityId: targetId, songVersionId: targetId, metadata: { folded: songId, arrangement: ownArrangementId } },
    });
    return { arrangementId: ownArrangementId };
  }
}
