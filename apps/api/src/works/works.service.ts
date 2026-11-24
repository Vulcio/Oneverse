import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { BINNED_TOO, type Prisma, type VersionRelationshipType } from "@oneverse/db";
import { MusicBrainzWorkMatchSchema, type MusicBrainzWorkMatch, type SongRelation } from "@oneverse/core";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { MusicBrainzService } from "../musicbrainz/musicbrainz.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const DETAIL_INCLUDE = {
  versions: {
    select: {
      id: true,
      title: true,
      // Tells it apart from the others (issue #390: Practice's version picker).
      versionName: true,
      language: true,
      ownerScope: true,
      publicationState: true,
      // How it's linked to the song it comes from (issue #78): a translation, an adaptation.
      parentVersionId: true,
      relationshipType: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  identifiers: true,
} satisfies Prisma.WorkInclude;

const RELATED_SELECT = {
  id: true,
  workId: true,
  language: true,
  parentVersionId: true,
  ownerScope: true,
  ownerUserId: true,
  ownerTeamId: true,
  publicationState: true,
  deletedAt: true,
} satisfies Prisma.SongVersionSelect;

@Injectable()
export class WorksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly musicBrainz: MusicBrainzService,
    private readonly access: AccessPolicyService,
  ) {}

  /** A Work with the versions of it the user can see - not found if they can see none. */
  async findOne(user: AuthenticatedUser, id: string) {
    const visible = await this.access.songsVisibleTo(user);
    const work = await this.prisma.client.work.findUnique({
      where: { id },
      include: { ...DETAIL_INCLUDE, versions: { ...DETAIL_INCLUDE.versions, where: visible } },
    });
    if (!work || work.versions.length === 0) throw new NotFoundException("Work not found");
    return work;
  }


  /**
   * A Work carries no owner of its own — ownership lives on its versions
   * (spec §6). Editing a Work-level record (like its MusicBrainz Work
   * link) is allowed to anyone who could edit at least one of its
   * versions, mirroring SongVersionOwnerGuard's per-version rule.
   */
  private async assertCanEditWork(workId: string, user: AuthenticatedUser): Promise<void> {
    const versions = await this.prisma.client.songVersion.findMany({
      where: { workId },
      select: { ownerScope: true, ownerUserId: true, ownerTeamId: true },
    });
    if (versions.length === 0) throw new NotFoundException("Work not found");
    for (const version of versions) if (await this.access.canEdit(user, version)) return;
    throw new ForbiddenException("Not authorized to edit this work");
  }


  async linkMusicBrainzWork(workId: string, user: AuthenticatedUser, mbid: string) {
    await this.assertCanEditWork(workId, user);
    const match = await this.musicBrainz.getWork(mbid);
    await this.prisma.client.workIdentifier.upsert({
      where: { workId_type: { workId, type: "MUSICBRAINZ_WORK" } },
      create: {
        workId,
        type: "MUSICBRAINZ_WORK",
        value: mbid,
        sourceUrl: match.sourceUrl,
        verifiedAt: new Date(),
        details: match,
      },
      update: { value: mbid, sourceUrl: match.sourceUrl, verifiedAt: new Date(), details: match },
    });
    return match;
  }

  async unlinkMusicBrainzWork(workId: string, user: AuthenticatedUser) {
    await this.assertCanEditWork(workId, user);
    await this.prisma.client.workIdentifier.deleteMany({
      where: { workId, type: "MUSICBRAINZ_WORK" },
    });
  }

  /**
   * The linked MusicBrainz work, as saved when it was linked (see
   * SongVersionsService.getMetadataMatch); an older link is looked up
   * once and saved.
   */
  async getMusicBrainzInfo(user: AuthenticatedUser, workId: string): Promise<MusicBrainzWorkMatch | null> {
    await this.findOne(user, workId);
    const identifier = await this.prisma.client.workIdentifier.findUnique({
      where: { workId_type: { workId, type: "MUSICBRAINZ_WORK" } },
    });
    if (!identifier) return null;
    const saved = MusicBrainzWorkMatchSchema.safeParse(identifier.details);
    if (saved.success && saved.data.mbid === identifier.value) return saved.data;
    const match = await this.musicBrainz.getWork(identifier.value);
    await this.prisma.client.workIdentifier.update({ where: { id: identifier.id }, data: { details: match } });
    return match;
  }

  /**
   * Links another song to this one as a related song (issue #557): its
   * original, a translation of it or an adaptation of it. Related songs are
   * the songs of one Work, so the other song's Work joins this one's; the
   * song that comes from the other gets its parent and how it relates.
   * Allowed to whoever can see both and change either.
   */
  async linkRelated(user: AuthenticatedUser, songId: string, otherId: string, relation: SongRelation) {
    if (songId === otherId) throw new BadRequestException(["songVersionId must be another song"]);
    const [song, other] = await Promise.all([this.relatedSong(user, songId), this.relatedSong(user, otherId)]);
    await this.assertCanChangeEither(user, song, other);
    const [child, parent] = relation === "original" ? [song, other] : [other, song];
    const type: VersionRelationshipType =
      relation === "translation" || (relation === "original" && child.language !== parent.language) ? "DIRECT_TRANSLATION" : "LYRICAL_ADAPTATION";
    if (await this.comesFrom(parent.id, child.id)) throw new BadRequestException(["songVersionId already comes from this song"]);

    await this.prisma.client.$transaction(async (tx) => {
      if (other.workId !== song.workId) {
        const [kept, gone] = await Promise.all([
          tx.work.findUniqueOrThrow({ where: { id: song.workId }, select: { preferredOriginalVersionId: true, identifiers: { select: { type: true } } } }),
          tx.work.findUniqueOrThrow({ where: { id: other.workId }, select: { preferredOriginalVersionId: true, identifiers: { select: { id: true, type: true } } } }),
        ]);
        await tx.work.update({ where: { id: other.workId }, data: { preferredOriginalVersionId: null } });
        await tx.songVersion.updateMany({ where: { workId: other.workId, ...BINNED_TOO }, data: { workId: song.workId } });
        // A composition's ids (ISWC, MusicBrainz) the kept Work hasn't got yet come along; the others go with the old Work.
        const keptTypes = new Set(kept.identifiers.map((identifier) => identifier.type));
        const moving = gone.identifiers.filter((identifier) => !keptTypes.has(identifier.type)).map((identifier) => identifier.id);
        if (moving.length) await tx.workIdentifier.updateMany({ where: { id: { in: moving } }, data: { workId: song.workId } });
        if (!kept.preferredOriginalVersionId && gone.preferredOriginalVersionId) {
          await tx.work.update({ where: { id: song.workId }, data: { preferredOriginalVersionId: gone.preferredOriginalVersionId } });
        }
        await tx.work.delete({ where: { id: other.workId } });
      }
      await tx.songVersion.update({ where: { id: child.id }, data: { parentVersionId: parent.id, relationshipType: type } });
    });
    return this.findOne(user, song.workId);
  }

  /**
   * Unlinks a related song (issue #557): it leaves this song's Work for one
   * of its own, and no song is said to come from it any more, nor it from
   * one. Allowed to whoever can see both and change either.
   */
  async unlinkRelated(user: AuthenticatedUser, songId: string, otherId: string) {
    const [song, other] = await Promise.all([this.relatedSong(user, songId), this.relatedSong(user, otherId)]);
    if (song.id === other.id || song.workId !== other.workId) throw new NotFoundException("Related song not found");
    await this.assertCanChangeEither(user, song, other);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.work.updateMany({ where: { id: song.workId, preferredOriginalVersionId: other.id }, data: { preferredOriginalVersionId: null } });
      await tx.songVersion.updateMany({ where: { workId: song.workId, parentVersionId: other.id, ...BINNED_TOO }, data: { parentVersionId: null, relationshipType: null } });
      const work = await tx.work.create({ data: { preferredOriginalVersionId: other.id } });
      await tx.songVersion.update({ where: { id: other.id }, data: { workId: work.id, parentVersionId: null, relationshipType: null } });
    });
    return this.findOne(user, song.workId);
  }

  private async relatedSong(user: AuthenticatedUser, id: string) {
    const song = await this.prisma.client.songVersion.findUnique({ where: { id }, select: RELATED_SELECT });
    if (!song || !(await this.access.canSeeSong(user, song))) throw new NotFoundException("Song version not found");
    return song;
  }

  private async assertCanChangeEither(user: AuthenticatedUser, ...songs: Prisma.SongVersionGetPayload<{ select: typeof RELATED_SELECT }>[]) {
    for (const song of songs) if (await this.access.canEditContent(user, song)) return;
    throw new ForbiddenException("Not authorized to change either song");
  }

  /** Whether `songId` comes from `ancestorId`, through its parents. */
  private async comesFrom(songId: string, ancestorId: string): Promise<boolean> {
    const seen = new Set<string>();
    for (let id: string | null = songId; id && !seen.has(id); ) {
      if (id === ancestorId) return true;
      seen.add(id);
      const row: { parentVersionId: string | null } | null = await this.prisma.client.songVersion.findUnique({ where: { id }, select: { parentVersionId: true } });
      id = row?.parentVersionId ?? null;
    }
    return false;
  }
}
