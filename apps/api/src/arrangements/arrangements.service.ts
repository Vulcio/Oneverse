import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ArrangementDocumentV2Schema,
  ChartPreferencesSchema,
  findArrangementProblems,
  generateId,
  ID_PREFIXES,
  newArrangementDocument,
  readArrangementDocument,
  readSongDocument,
  transposeKey,
  type ArrangementDocumentV2,
  type ChartPreferences,
  type SongDocumentV2,
} from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SongLinksService } from "../song-links/song-links.service.js";
import type { CreateArrangementDto, UpdateArrangementDto } from "./dto/arrangement.dto.js";

const SELECT = {
  id: true,
  songVersionId: true,
  name: true,
  description: true,
  ownerScope: true,
  ownerUserId: true,
  ownerTeamId: true,
  isTeamDefault: true,
  linkId: true,
  multitrackId: true,
  documentJson: true,
  updatedAt: true,
  setlistItem: { select: { setlistId: true } },
  ownerTeam: { select: { name: true } },
  ownerUser: { select: { displayName: true } },
} satisfies Prisma.ArrangementSelect;
type Row = Prisma.ArrangementGetPayload<{ select: typeof SELECT }>;

const SONG_SELECT = { id: true, documentJson: true, ownerScope: true, ownerUserId: true, ownerTeamId: true, publicationState: true } as const;

export interface ArrangementSummary {
  id: string;
  songVersionId: string;
  name: string;
  description: string | null;
  ownerScope: string;
  teamId: string | null;
  teamName: string | null;
  ownerName: string | null;
  isTeamDefault: boolean;
  /** The song's reference recording it's played along to (issue #346); null: the song's own. */
  linkId: string | null;
  /** The song's multitrack it plays (issue #346); null: the song's own. */
  multitrackId: string | null;
  /** Set when it's one song's arrangement for one set (see SetlistsService): the set's id. */
  setlistId: string | null;
  /** The key it's played in (the song's key moved by its transposition), when the song has one. */
  key: string | null;
  transposeSteps: number;
  capo: number | null;
  /** The song changed since the arrangement was last checked against it. */
  needsReview: boolean;
  canEdit: boolean;
  updatedAt: string;
}

const itemId = () => generateId(ID_PREFIXES.arrangementItem);

/**
 * Arrangements (docs/arrangement-document-v2.md): how a user or a team plays
 * a song they can see - order, key, capo, tempo, per-pass overrides - stored
 * apart from the song and pointing at it by ID. Also a player's own chart
 * preferences, which change nothing for anyone else.
 */
@Injectable()
export class ArrangementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
  ) {}

  /** The song's arrangements the user can see: their own, then their teams'. */
  async listForSong(user: AuthenticatedUser, songVersionId: string): Promise<ArrangementSummary[]> {
    const song = await this.visibleSong(user, songVersionId);
    const rows = await this.prisma.client.arrangement.findMany({
      // A set's own arrangements are found through their set.
      where: { AND: [{ songVersionId, setlistItemId: null }, await this.access.arrangementsVisibleTo(user)] },
      select: SELECT,
      orderBy: [{ ownerScope: "desc" }, { name: "asc" }],
    });
    return Promise.all(rows.map(async (row) => this.summarize(row, song, await this.access.canEdit(user, row))));
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const row = await this.visibleArrangement(user, id);
    const song = await this.visibleSong(user, row.songVersionId);
    return this.detail(row, song, await this.access.canEdit(user, row));
  }

  async create(user: AuthenticatedUser, songVersionId: string, dto: CreateArrangementDto) {
    const song = await this.visibleSong(user, songVersionId);
    if (dto.teamId) {
      if (!user.isGlobalAdmin && (await this.access.teamRole(user.id, dto.teamId)) !== "ADMIN") {
        throw new ForbiddenException("Team admin role required to add a version for this team");
      }
      await this.access.assertSongverseTeam(dto.teamId);
    }
    let document = newArrangementDocument(song.document, songVersionId, itemId);
    // A copy plays along to the same recording and multitrack (issue #346).
    let media: { linkId: string | null; multitrackId: string | null } = { linkId: null, multitrackId: null };
    if (dto.copyFromId) {
      const source = await this.visibleArrangement(user, dto.copyFromId);
      media = { linkId: source.linkId, multitrackId: source.multitrackId };
      if (source.songVersionId !== songVersionId) throw new BadRequestException("Can only copy a version of the same song");
      const copied = readArrangementDocument(source.documentJson, song.document, songVersionId, itemId).document;
      document = { ...copied, items: copied.items.map((item) => ({ ...item, id: itemId() })) };
    }
    const row = await this.prisma.client.arrangement.create({
      data: {
        songVersionId,
        name: dto.name,
        description: dto.description || null,
        ...(dto.teamId ? { ownerScope: "TEAM", ownerTeamId: dto.teamId } : { ownerScope: "USER", ownerUserId: user.id }),
        documentJson: document as object,
        ...media,
      },
      select: SELECT,
    });
    return this.detail(row, song, true);
  }

  /**
   * One song's own arrangement for one set (reordering, skipping or repeating
   * sections just there), which the set then plays: a copy of the one it
   * played, or the song's order. Owned like the set; the caller checks the
   * user can change the set and see the song. Returns the existing one if
   * the song already has one in this set.
   */
  async forSetItem(
    user: AuthenticatedUser,
    set: { ownerTeamId: string | null; ownerUserId: string | null },
    item: { id: string; songVersionId: string; arrangementId: string | null },
    name: string,
  ): Promise<string> {
    const existing = await this.prisma.client.arrangement.findUnique({ where: { setlistItemId: item.id }, select: { id: true } });
    let id = existing?.id;
    if (!id) {
      const song = await this.visibleSong(user, item.songVersionId);
      let document = newArrangementDocument(song.document, item.songVersionId, itemId);
      const played = item.arrangementId
        ? await this.prisma.client.arrangement.findUnique({ where: { id: item.arrangementId }, select: { documentJson: true, linkId: true, multitrackId: true } })
        : null;
      if (played) {
        const copied = readArrangementDocument(played.documentJson, song.document, item.songVersionId, itemId).document;
        document = { ...copied, items: copied.items.map((pass) => ({ ...pass, id: itemId() })) };
      }
      ({ id } = await this.prisma.client.arrangement.create({
        data: {
          songVersionId: item.songVersionId,
          name,
          setlistItemId: item.id,
          ...(set.ownerTeamId ? { ownerScope: "TEAM", ownerTeamId: set.ownerTeamId } : { ownerScope: "USER", ownerUserId: set.ownerUserId }),
          documentJson: document as object,
          // What the version it was copied from plays along to (issue #346).
          linkId: played?.linkId ?? null,
          multitrackId: played?.multitrackId ?? null,
        },
        select: { id: true },
      }));
    }
    await this.prisma.client.setlistItem.update({ where: { id: item.id }, data: { arrangementId: id } });
    return id;
  }

  /**
   * Partial update. `document` replaces the arrangement's (checked against
   * the format; references the song no longer has are allowed and shown as
   * problems). `updatedAt` refuses a save over someone else's newer one.
   */
  async update(user: AuthenticatedUser, id: string, dto: UpdateArrangementDto) {
    const row = await this.editableArrangement(user, id);
    const song = await this.visibleSong(user, row.songVersionId);
    if (dto.updatedAt && new Date(dto.updatedAt).getTime() !== row.updatedAt.getTime()) throw staleArrangement();
    let document: ArrangementDocumentV2 | undefined;
    if (dto.document) {
      const parsed = ArrangementDocumentV2Schema.safeParse(dto.document);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        throw new BadRequestException(`document.${issue.path.join(".")}: ${issue.message}`);
      }
      if (parsed.data.songVersionId !== row.songVersionId) throw new BadRequestException("document.songVersionId: not this arrangement's song");
      document = parsed.data;
    }
    if (dto.isTeamDefault && (row.ownerScope !== "TEAM" || row.setlistItem)) throw new BadRequestException("Only a team's version can be the team's usual one");
    // What it plays along to (issue #346): one of the song's reference recordings the editor sees, one of its multitracks.
    if (dto.linkId) {
      const teamIds = await this.access.teamIds(user.id);
      const link = await this.prisma.client.songLink.findFirst({ where: { id: dto.linkId, songVersionId: row.songVersionId, ...SongLinksService.visibleWhere(user, teamIds) }, select: { id: true } });
      if (!link) throw new BadRequestException(["linkId must be one of the song's reference recordings"]);
    }
    if (dto.multitrackId) {
      const file = await this.prisma.client.attachment.findFirst({ where: { songVersionId: row.songVersionId, multitrackId: dto.multitrackId }, select: { id: true } });
      if (!file) throw new BadRequestException(["multitrackId must be one of the song's multitracks"]);
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      // Conditional on the version the check above saw, so two saves at once can't both win.
      const { count } = await tx.arrangement.updateMany({
        where: { id, updatedAt: row.updatedAt },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description || null }),
          ...(document && { documentJson: document as object }),
          ...(dto.isTeamDefault !== undefined && { isTeamDefault: dto.isTeamDefault }),
          ...(dto.linkId !== undefined && { linkId: dto.linkId }),
          ...(dto.multitrackId !== undefined && { multitrackId: dto.multitrackId }),
        },
      });
      if (count === 0) throw staleArrangement();
      if (dto.isTeamDefault) {
        await tx.arrangement.updateMany({
          where: { songVersionId: row.songVersionId, ownerTeamId: row.ownerTeamId, isTeamDefault: true, id: { not: id } },
          data: { isTeamDefault: false },
        });
      }
      return tx.arrangement.findUniqueOrThrow({ where: { id }, select: SELECT });
    });
    return this.detail(updated, song, true);
  }

  /** The song's changes since have been looked at: the arrangement is checked against its current revision. */
  async markReviewed(user: AuthenticatedUser, id: string) {
    const row = await this.editableArrangement(user, id);
    const song = await this.visibleSong(user, row.songVersionId);
    const { document } = readArrangementDocument(row.documentJson, song.document, row.songVersionId, itemId);
    const updated = await this.prisma.client.arrangement.update({
      where: { id },
      data: { documentJson: { ...document, songRevision: song.document.revision } as object },
      select: SELECT,
    });
    return this.detail(updated, song, true);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    await this.editableArrangement(user, id);
    await this.prisma.client.$transaction([
      this.prisma.client.setlistItem.updateMany({ where: { arrangementId: id }, data: { arrangementId: null } }),
      this.prisma.client.arrangement.delete({ where: { id } }),
    ]);
  }

  // --- used by sets

  /** A team's usual arrangement of a song, if it has one. */
  async teamDefaultId(teamId: string, songVersionId: string): Promise<string | null> {
    const row = await this.prisma.client.arrangement.findFirst({
      where: { ownerTeamId: teamId, songVersionId, isTeamDefault: true },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * The arrangements a set can play for these songs: for a team set, the
   * team's own; for a personal set, its owner's and their teams'. (Anyone
   * who can open the set then sees the one it plays.)
   */
  async choicesForSet(
    set: { ownerTeamId: string | null; ownerUserId: string | null },
    songVersionIds: string[],
  ): Promise<Map<string, { id: string; name: string; isTeamDefault: boolean }[]>> {
    const owners: Prisma.ArrangementWhereInput = set.ownerTeamId
      ? { ownerScope: "TEAM", ownerTeamId: set.ownerTeamId }
      : {
          OR: [
            { ownerScope: "USER", ownerUserId: set.ownerUserId },
            { ownerScope: "TEAM", ownerTeamId: { in: set.ownerUserId ? await this.access.teamIds(set.ownerUserId) : [] } },
          ],
        };
    const rows = await this.prisma.client.arrangement.findMany({
      where: { AND: [{ songVersionId: { in: songVersionIds }, setlistItemId: null }, owners] },
      select: { id: true, name: true, isTeamDefault: true, songVersionId: true },
      orderBy: { name: "asc" },
    });
    const bySong = new Map<string, { id: string; name: string; isTeamDefault: boolean }[]>();
    for (const { songVersionId, ...choice } of rows) bySong.set(songVersionId, [...(bySong.get(songVersionId) ?? []), choice]);
    return bySong;
  }

  /** Throws unless the set can play this arrangement of this song (see choicesForSet), or it's this set song's own. */
  async assertPlayableInSet(
    set: { ownerTeamId: string | null; ownerUserId: string | null },
    songVersionId: string,
    arrangementId: string,
    setlistItemId: string,
  ) {
    const own = await this.prisma.client.arrangement.findUnique({ where: { setlistItemId }, select: { id: true } });
    if (own?.id === arrangementId) return;
    const choices = (await this.choicesForSet(set, [songVersionId])).get(songVersionId) ?? [];
    if (!choices.some((choice) => choice.id === arrangementId)) {
      throw new BadRequestException(
        set.ownerTeamId ? "A team set can only play the team's own arrangements of the song" : "Not an arrangement of this song the set's owner can use",
      );
    }
  }

  /** An arrangement as a set shows it: its document, read against the song. */
  async forChart(arrangementId: string, song: SongDocumentV2) {
    const row = await this.prisma.client.arrangement.findUnique({ where: { id: arrangementId }, select: SELECT });
    if (!row) return null;
    const { document } = readArrangementDocument(row.documentJson, song, row.songVersionId, itemId);
    // What it plays along to (issue #346), for the set's song page.
    return { id: row.id, name: row.name, document, linkId: row.linkId, multitrackId: row.multitrackId };
  }

  // --- a player's own chart preferences

  async preferences(userId: string, songVersionId: string, arrangementId: string | null): Promise<ChartPreferences> {
    const row = await this.prisma.client.chartPreference.findUnique({
      where: { userId_songVersionId_arrangementKey: { userId, songVersionId, arrangementKey: arrangementId ?? "" } },
      select: { preferencesJson: true },
    });
    const parsed = ChartPreferencesSchema.safeParse(row?.preferencesJson ?? { $schema: "chart-preferences/v1" });
    return parsed.success ? parsed.data : ChartPreferencesSchema.parse({ $schema: "chart-preferences/v1" });
  }

  /**
   * Saves the player's preferences for a chart they can see (checked by the
   * caller), over what's saved: a field left out keeps its value - the Live
   * view switch (issue #155) and My view save their own fields.
   */
  async savePreferences(userId: string, songVersionId: string, arrangementId: string | null, input: unknown): Promise<ChartPreferences> {
    const saved = await this.preferences(userId, songVersionId, arrangementId);
    const parsed = ChartPreferencesSchema.safeParse({ ...saved, ...(input as object), $schema: "chart-preferences/v1" });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      throw new BadRequestException(`preferences.${issue.path.join(".")}: ${issue.message}`);
    }
    if (arrangementId) {
      const arrangement = await this.prisma.client.arrangement.findUnique({ where: { id: arrangementId }, select: { songVersionId: true } });
      if (arrangement?.songVersionId !== songVersionId) throw new BadRequestException("Not a version of this song");
    }
    const arrangementKey = arrangementId ?? "";
    await this.prisma.client.chartPreference.upsert({
      where: { userId_songVersionId_arrangementKey: { userId, songVersionId, arrangementKey } },
      create: { userId, songVersionId, arrangementId, arrangementKey, preferencesJson: parsed.data as object },
      update: { preferencesJson: parsed.data as object },
    });
    return parsed.data;
  }

  /** Preferences for a song the user can open in their library. */
  async savePreferencesForSong(user: AuthenticatedUser, songVersionId: string, arrangementId: string | null, input: unknown) {
    await this.access.assertCanSeeSong(user, songVersionId);
    if (arrangementId) await this.visibleArrangement(user, arrangementId);
    return this.savePreferences(user.id, songVersionId, arrangementId, input);
  }

  async preferencesForSong(user: AuthenticatedUser, songVersionId: string, arrangementId: string | null) {
    await this.access.assertCanSeeSong(user, songVersionId);
    if (arrangementId) await this.visibleArrangement(user, arrangementId);
    return this.preferences(user.id, songVersionId, arrangementId);
  }

  // --- helpers

  private async visibleSong(user: AuthenticatedUser, songVersionId: string) {
    const song = await this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: SONG_SELECT });
    if (!song) throw new NotFoundException("Song version not found");
    if (!(await this.access.canSeeSong(user, song))) throw new ForbiddenException("Not visible to you");
    return { ...song, document: readSongDocument(song.documentJson) };
  }

  private async visibleArrangement(user: AuthenticatedUser, id: string): Promise<Row> {
    const row = await this.prisma.client.arrangement.findUnique({ where: { id }, select: SELECT });
    if (!row) throw new NotFoundException("Version not found");
    if (!(await this.access.canSeeArrangement(user, row))) throw new ForbiddenException("Not visible to you");
    return row;
  }

  private async editableArrangement(user: AuthenticatedUser, id: string): Promise<Row> {
    const row = await this.visibleArrangement(user, id);
    await this.access.assertCanEdit(user, row, "arrangement");
    return row;
  }

  private summarize(row: Row, song: { document: SongDocumentV2 }, canEdit: boolean): ArrangementSummary {
    const { document, readable } = readArrangementDocument(row.documentJson, song.document, row.songVersionId, itemId);
    const steps = document.defaults.transposeSteps ?? 0;
    const songKey = song.document.defaults.key ?? null;
    return {
      id: row.id,
      songVersionId: row.songVersionId,
      name: row.name,
      description: row.description,
      ownerScope: row.ownerScope,
      teamId: row.ownerTeamId,
      teamName: row.ownerTeam?.name ?? null,
      ownerName: row.ownerUser?.displayName ?? null,
      isTeamDefault: row.isTeamDefault,
      linkId: row.linkId,
      multitrackId: row.multitrackId,
      setlistId: row.setlistItem?.setlistId ?? null,
      key: songKey ? (transposeKey(songKey, steps) ?? songKey) : null,
      transposeSteps: steps,
      capo: document.defaults.capo || null,
      needsReview: !readable || document.songRevision < song.document.revision,
      canEdit,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private detail(row: Row, song: { document: SongDocumentV2 }, canEdit: boolean) {
    const { document, readable } = readArrangementDocument(row.documentJson, song.document, row.songVersionId, itemId);
    return {
      ...this.summarize(row, song, canEdit),
      document,
      song: { revision: song.document.revision, key: song.document.defaults.key ?? null },
      problems: [...(readable ? [] : ["Saved in an older format: it starts again from the song's order"]), ...findArrangementProblems(document, song.document)],
    };
  }
}

function staleArrangement(): ConflictException {
  return new ConflictException("This version was changed somewhere else since you opened it. Reload it to see the changes.");
}
