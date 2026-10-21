import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@oneverse/db";
import { MusicBrainzWorkMatchSchema, type MusicBrainzWorkMatch } from "@oneverse/core";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { MusicBrainzService } from "../musicbrainz/musicbrainz.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const DETAIL_INCLUDE = {
  versions: {
    select: {
      id: true,
      title: true,
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
}
