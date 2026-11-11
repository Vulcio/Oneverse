import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  computeSectionLabel,
  foldForSearch,
  formatSongbookReference,
  MetadataMatchSchema,
  MusicBrainzRecordingMatchSchema,
  detectImportFormat,
  flowItemId,
  parseSongDocumentV2,
  parseStreamingLink,
  readReferenceLink,
  readSongDocument,
  safeParseSongDocumentV2,
  snapshotChanges,
  songDocumentFromSections,
  songDocumentFromText,
  songFromText,
  songInfoProposals,
  type SongInfoCurrent,
  type SongInfoField,
  songToChordPro,
  splitNames,
  type CatalogEntryData,
  type MetadataMatch,
  type MetadataSource,
  type SongbookSection,
  type SongDefaultsV2,
  type SongDocumentV2,
  type SongSnapshot,
  type StreamingIdentifierType,
  type SupportedImportFormat,
  type SongFields,
  lyricsLines,
  lyricsSearchText,
  matchLyrics,
  parseLyricsQuery,
  type LyricsMatch,
} from "@oneverse/core";
import type { ContributorRole, Prisma, VersionRelationshipType } from "@oneverse/db";
import { recordingAsMatch } from "./metadata-match-backfill.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AccessPolicyService, OPEN_SUBMISSION_STATES } from "../access/access-policy.service.js";
import { songbookReferencesOf } from "../songbooks/songbook-references.js";
import { SetlistAccessService } from "../setlists/setlist-access.service.js";
import { songSearchWhere } from "./song-search.js";
import type { CreateSongVersionDto } from "./dto/create-song-version.dto.js";
import type { ListSongVersionsQueryDto } from "./dto/list-song-versions-query.dto.js";
import type { UpdateSongVersionDto } from "./dto/update-song-version.dto.js";
import { ArtistsService, artistKey } from "../artists/artists.service.js";
import { ArtworkService } from "../artwork/artwork.service.js";
import { MetadataService } from "../metadata/metadata.service.js";
import { StorageService } from "../storage/storage.service.js";
import { SongHistoryService } from "./song-history.service.js";
import { creditListsFrom, mergeCredits, replaceAutoAttachedArtist, replaceCredits } from "./song-credits.js";
import { DETAIL_SELECT, LIST_SELECT, STREAMING_TYPE_OF, tagsVisibleWhere, toDetailItem, toListItem, type DetailItem, type ListItem, type ListRow, type Rights, type SeesTag, type SharedBy, type SongPage, type SongVersionOwner } from "./song-version-rows.js";

/** A version's own fields: the columns (the document holds only the music). */
type VersionFields = {
  title: string;
  language: string;
  alternateTitle?: string | null;
  versionName?: string | null;
  sortTitle?: string | null;
  album?: string | null;
  year?: number | null;
  copyright?: string | null;
  copyrightYear?: number | null;
  publisher?: string | null;
  ccli?: string | null;
  isrc?: string | null;
  reference?: string | null;
  notes?: string | null;
};

type CreateExtras = {
  defaults?: SongDefaultsV2;
  sections?: SongDocumentV2["sections"];
  flow?: SongDocumentV2["flow"];
  capo?: number | null;
  credits?: { source: string; roles: ContributorRole[] }[];
  tagIds?: string[];
  /** Recordings to link it to (a catalogue entry's, issue #210): the first on each service. */
  links?: string[];
  /** Add to this existing Work. */
  workId?: string;
  /** Derived from this version (e.g. a translation of it): joins its Work. */
  parent?: { id: string; workId: string; relationshipType: VersionRelationshipType };
  /** Who made it, for its history. */
  authorUserId?: string;
};

/** The chart's defaults a DTO sets (undefined leaves one alone, null clears it). */
function defaultsFrom(dto: SongFields): SongDefaultsV2 {
  return {
    ...(dto.key !== undefined && { key: dto.key }),
    ...(dto.tempo !== undefined && { tempo: dto.tempo }),
    ...(dto.tempoUnit !== undefined && { tempoUnit: dto.tempoUnit }),
    ...(dto.metronomeBeats !== undefined && { metronomeBeats: dto.metronomeBeats }),
    ...(dto.timeSignature !== undefined && { timeSignature: parseTimeSignature(dto.timeSignature) }),
    ...(dto.durationSeconds !== undefined && { durationSeconds: dto.durationSeconds }),
  };
}

function staleRevision(): ConflictException {
  return new ConflictException("This song was changed somewhere else since you opened it. Reload it to see the changes.");
}

/**
 * The chart as the structured editor sends it - its sections and/or the
 * order they're sung in, IDs as they are - checked as a whole document
 * would be (IDs unique, chords on characters and in order, the flow only
 * naming sections that exist); a 400 naming the first problem otherwise.
 * `current` stands in for sections not sent.
 */
function chartFrom(
  dto: SongFields,
  current: SongDocumentV2["sections"],
): { sections: SongDocumentV2["sections"]; flow: SongDocumentV2["flow"] | undefined } | undefined {
  if (dto.sections === undefined && dto.flow === undefined) return undefined;
  if (dto.content !== undefined) throw new BadRequestException("Send the chart as content or as sections, not both");
  const sections = dto.sections ?? current;
  const parsed = safeParseSongDocumentV2({
    $schema: "song-document/v2",
    revision: 0,
    defaults: {},
    sections,
    flow: dto.flow ?? (sections as { id?: unknown }[]).map((section) => ({ id: `fi_${String(section?.id)}`, sectionId: section?.id })),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new BadRequestException(`${issue.path.join(".")}: ${issue.message}`);
  }
  return { sections: parsed.data.sections, flow: dto.flow === undefined ? undefined : parsed.data.flow };
}

function parseTimeSignature(text: string | null): { numerator: number; denominator: number } | null {
  const match = text ? /^(\d+)\/(\d+)$/.exec(text) : null;
  return match ? { numerator: Number(match[1]), denominator: Number(match[2]) } : null;
}

function foldName(name: string): string {
  return foldForSearch(name).trim().replace(/\s+/g, " ");
}

/** A name someone's already credited under, for autocomplete. */
export interface CreditSuggestion {
  name: string;
  roles: ContributorRole[];
  songCount: number;
}

const MATCH_VERSION_SELECT = {
  id: true,
  workId: true,
  title: true,
  versionName: true,
  language: true,
  ownerScope: true,
  ownerTeam: { select: { name: true } },
  documentJson: true,
  contributors: {
    where: { roles: { has: "PERFORMER" as ContributorRole } },
    select: { source: true },
    orderBy: { displayOrder: "asc" },
  },
} satisfies Prisma.SongVersionSelect;

/** A library list's order: its sort, newest first by default; ties (same title, say) in a stable order. */
/** How many songs with the words searched are checked line by line (issue #221). */
const LYRICS_CANDIDATES = 300;

function listOrder(query: ListSongVersionsQueryDto): Prisma.SongVersionOrderByWithRelationInput[] {
  const sort = query.sort ?? "updatedAt";
  const dir = query.dir ?? (sort === "updatedAt" || sort === "createdAt" ? "desc" : "asc");
  return [{ [sort]: dir }, { id: "asc" }];
}

@Injectable()
export class SongVersionsService {
  private readonly logger = new Logger(SongVersionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly history: SongHistoryService,
    private readonly storage: StorageService,
    private readonly metadata: MetadataService,
    private readonly artwork: ArtworkService,
    private readonly artists: ArtistsService,
    private readonly sets: SetlistAccessService,
  ) {}

  /**
   * One page of the songs the user can see, searched and filtered, with
   * the total across all pages. `q` matches the title, subtitle, version
   * name or an artist (anywhere in them, ignoring case, accents and
   * punctuation - songSearchWhere()), or a CCLI number exactly.
   */
  async findVisibleToUser(user: AuthenticatedUser, query: ListSongVersionsQueryDto = {}): Promise<SongPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = await this.listWhere(user, query);
    if (query.in === "lyrics") return this.findByLyrics(user, query, where, page, pageSize);
    const [total, versions] = await Promise.all([
      this.prisma.client.songVersion.count({ where }),
      this.prisma.client.songVersion.findMany({
        where,
        select: LIST_SELECT,
        orderBy: listOrder(query),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: await this.pageItems(user, versions, query), total, page, pageSize };
  }

  /**
   * Songs found by their words (issue #221): the database narrows them to
   * those with every word searched (the trigram-indexed lyricsText), then
   * each is checked line by line - the words in order, on one line - and
   * comes with the line found. In the list's order; the first
   * LYRICS_CANDIDATES songs with the words are looked at.
   */
  private async findByLyrics(user: AuthenticatedUser, query: ListSongVersionsQueryDto, where: Prisma.SongVersionWhereInput, page: number, pageSize: number): Promise<SongPage> {
    const terms = parseLyricsQuery(query.q ?? "");
    if (!terms) return { items: [], total: 0, page, pageSize };
    // Checked on the folded lines the database keeps (lyricsText, issue #341): only the page's songs' charts are read, for the line as written.
    const rows = await this.prisma.client.songVersion.findMany({ where, select: { id: true, lyricsText: true }, orderBy: listOrder(query), take: LYRICS_CANDIDATES });
    const matching = rows.filter((row) => row.lyricsText && matchLyrics(terms, row.lyricsText.split("\n").map((text) => ({ text })))).map((row) => row.id);
    const ids = matching.slice((page - 1) * pageSize, page * pageSize);
    const found = new Map((await this.prisma.client.songVersion.findMany({ where: { id: { in: ids } }, select: { ...LIST_SELECT, documentJson: true } })).map((version) => [version.id, version]));
    const matches = new Map<string, LyricsMatch>();
    for (const id of ids) {
      const version = found.get(id);
      if (!version) continue;
      try {
        const match = matchLyrics(terms, lyricsLines(readSongDocument(version.documentJson)));
        if (match) matches.set(id, match);
      } catch {
        // A chart it can't read: not found by its words.
      }
    }
    const versions = ids.filter((id) => matches.has(id)).map((id) => found.get(id)!);
    const items = await this.pageItems(user, versions, query);
    return { items: items.map((item) => ({ ...item, lyricsMatch: matches.get(item.id)! })), total: matching.length, page, pageSize };
  }

  /** A page's songs as listed: their images signed, who shared them, and where they are in the user's songbooks when asked. */
  private async pageItems(user: AuthenticatedUser, versions: ListRow[], query: ListSongVersionsQueryDto): Promise<ListItem[]> {
    const seesTag = await this.seesTag(user);
    const [shared, privateIds] = await Promise.all([this.sharedByOf(user, versions.map((version) => version.id)), this.privateAmong(user, versions)]);
    // Where each is in the user's songbooks, when asked (issue #213: beside the songs a search finds).
    const references = query.references ? await songbookReferencesOf(this.prisma, await this.access.songbooksVisibleTo(user), versions.map((version) => version.id)) : null;
    return versions.map((version) => ({
      ...toListItem(version, seesTag, shared.get(version.id) ?? null, privateIds),
      ...(references && { songbookReferences: references.get(version.id) ?? [] }),
    }));
  }

  /**
   * The songs before and after `id` in a list (issue #84) - the library's,
   * searched, filtered and sorted as `query` says - and where it is in it.
   * Null position when it isn't in the list (any more).
   */
  async neighbors(user: AuthenticatedUser, id: string, query: ListSongVersionsQueryDto = {}) {
    // Found from the song's own place in the order (issue #341), rather than by reading the whole list.
    const where = await this.listWhere(user, query);
    const sort = query.sort ?? "updatedAt";
    const dir = query.dir ?? (sort === "updatedAt" || sort === "createdAt" ? "desc" : "asc");
    const [current, total] = await Promise.all([
      this.prisma.client.songVersion.findFirst({ where: { AND: [where, { id }] }, select: { id: true, [sort]: true } }),
      this.prisma.client.songVersion.count({ where }),
    ]);
    if (!current) return { position: null, total, previous: null, next: null };
    const value = (current as Record<string, unknown>)[sort];
    // Before it in the list: earlier by the sort, or the same and a smaller id (listOrder's tie-break).
    const before: Prisma.SongVersionWhereInput = { OR: [{ [sort]: { [dir === "asc" ? "lt" : "gt"]: value } }, { [sort]: value, id: { lt: id } }] };
    const after: Prisma.SongVersionWhereInput = { OR: [{ [sort]: { [dir === "asc" ? "gt" : "lt"]: value } }, { [sort]: value, id: { gt: id } }] };
    const reversed: Prisma.SongVersionOrderByWithRelationInput[] = [{ [sort]: dir === "asc" ? "desc" : "asc" }, { id: "desc" }];
    const [earlier, previous, next] = await Promise.all([
      this.prisma.client.songVersion.count({ where: { AND: [where, before] } }),
      this.prisma.client.songVersion.findFirst({ where: { AND: [where, before] }, select: { id: true, title: true }, orderBy: reversed }),
      this.prisma.client.songVersion.findFirst({ where: { AND: [where, after] }, select: { id: true, title: true }, orderBy: listOrder(query) }),
    ]);
    return { position: earlier + 1, total, previous, next };
  }

  /** What a list of the library holds: the songs the user can see, searched and filtered as `query` says. */
  private async listWhere(user: AuthenticatedUser, query: ListSongVersionsQueryDto): Promise<Prisma.SongVersionWhereInput> {
    // Searched in the lyrics (issue #221): every word in the song's words, somewhere (findByLyrics checks the order).
    const lyrics = query.in === "lyrics" ? (parseLyricsQuery(query.q ?? "") ?? []) : null;
    const q = lyrics ? undefined : query.q?.trim();
    // Those that can go in a set the user changes (issue #328: its Add songs), or all they can see.
    const scope = query.addableTo ? await this.sets.pickableWhere(user, await this.sets.findEditable(user, query.addableTo)) : await this.access.songsVisibleTo(user);
    return {
      AND: [
        scope,
        ...(lyrics ? (lyrics.length > 0 ? lyrics.map((term) => ({ lyricsText: { contains: term } })) : [{ id: { in: [] } }]) : []),
        ...(q
          ? [
              // searchText is the title, subtitle, version name and performers (kept by the database; see the schema).
              await songSearchWhere(this.prisma, q, scope),
            ]
          : []),
        ...(query.language ? [{ language: query.language }] : []),
        // The user's favorites (issue #81).
        ...(query.favorites ? [{ favoritedBy: { some: { userId: user.id } } }] : []),
        ...(query.tagId ? [{ versionTags: { some: { tagId: query.tagId } } }] : []),
        // An artist's songs (issue #58): the whole name, ignoring case and accents.
        ...(query.artist
          ? [{ contributors: { some: { roles: { has: "PERFORMER" as const }, sourceSearch: { equals: await this.unaccent(query.artist), mode: "insensitive" as const } } } }]
          : []),
      ],
    };
  }

  /**
   * The artists credited on songs the user can see (issue #58), with how
   * many songs each, by name; `q` narrows them (ignoring accents). Names
   * differing only in case or accents are one artist.
   */
  async artistsForUser(user: AuthenticatedUser, query = ""): Promise<{ name: string; songCount: number; imageUrl: string | null }[]> {
    const q = query.trim();
    const groups = await this.prisma.client.versionContributor.groupBy({
      by: ["source"],
      where: {
        source: { not: null },
        roles: { has: "PERFORMER" },
        songVersion: await this.access.songsVisibleTo(user),
        ...(q && { sourceSearch: { contains: await this.unaccent(q), mode: "insensitive" } }),
      },
      _count: { _all: true },
    });
    const byName = new Map<string, { name: string; songCount: number; imageUrl: string | null }>();
    for (const group of groups) {
      const name = group.source!.trim();
      if (!name) continue;
      const key = artistKey(name);
      const entry = byName.get(key) ?? { name, songCount: 0, imageUrl: null };
      entry.songCount += group._count._all;
      byName.set(key, entry);
    }
    // Their pictures (issue #86).
    const pictures = await this.artists.picturesByKey([...byName.keys()]);
    for (const [key, entry] of byName) entry.imageUrl = pictures.get(key) ?? null;
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  /** How many songs, and distinct artists, the user can see - for the dashboard. */
  async statsForUser(user: AuthenticatedUser): Promise<{ songCount: number; artistCount: number; ownSongCount: number }> {
    const where = await this.access.songsVisibleTo(user);
    const [songCount, ownSongCount, artists] = await Promise.all([
      this.prisma.client.songVersion.count({ where }),
      // Theirs and their teams' (issue #350: getting started's first step).
      this.prisma.client.songVersion.count({ where: { deletedAt: null, OR: [{ ownerScope: "USER", ownerUserId: user.id }, { ownerScope: "TEAM", ownerTeamId: { in: await this.access.teamIds(user.id) } }] } }),
      // Grouped by the database (issue #341): Prisma's `distinct` read every credit and dropped the repeats itself.
      this.prisma.client.versionContributor.groupBy({
        by: ["source"],
        where: { roles: { has: "PERFORMER" }, source: { not: null }, songVersion: where },
      }),
    ]);
    return { songCount, ownSongCount, artistCount: new Set(artists.map((a) => a.source!.trim().toLowerCase())).size };
  }

  /**
   * `text` without accents, by the database's own unaccent() - the one that
   * keeps sourceSearch - so a query and what it's matched
   * against are folded the same way ("cœur" and "coeur" too) (issue #56).
   */
  private async unaccent(text: string): Promise<string> {
    const [row] = await this.prisma.client.$queryRaw<{ folded: string }[]>`SELECT unaccent(${text}) AS folded`;
    return row?.folded ?? text;
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<DetailItem & { isFavorite: boolean }> {
    const version = await this.prisma.client.songVersion.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });
    if (!version) throw new NotFoundException("Song version not found");
    if (!(await this.access.canSeeSong(user, version))) throw new ForbiddenException("Not visible to you");
    const isFavorite = (await this.prisma.client.favoriteSong.count({ where: { userId: user.id, songVersionId: id } })) > 0;
    const privateIds = await this.privateAmong(user, [version]);
    return { ...toDetailItem(version, await this.rightsOn(user, version), await this.seesTag(user)), private: privateIds.has(version.id), isFavorite };
  }

  /**
   * findOne for many songs at once (issue #122: a device's first offline
   * sync), with a few queries in all rather than several per song. Songs the
   * user can't see, or that don't exist, are left out.
   */
  async findDetails(user: AuthenticatedUser, ids: string[]): Promise<Map<string, DetailItem & { isFavorite: boolean }>> {
    if (ids.length === 0) return new Map();
    const [visible, canEdit, seesTag, shared, favorites] = await Promise.all([
      this.access.songsVisibleTo(user),
      this.access.editChecker(user),
      this.seesTag(user),
      this.sharedByOf(user, ids),
      this.prisma.client.favoriteSong.findMany({ where: { userId: user.id, songVersionId: { in: ids } }, select: { songVersionId: true } }),
    ]);
    const versions = await this.prisma.client.songVersion.findMany({ where: { AND: [visible, { id: { in: ids } }] }, select: DETAIL_SELECT });
    const favorite = new Set(favorites.map((row) => row.songVersionId));
    const privateIds = await this.privateAmong(user, versions);
    return new Map(
      versions.map((version) => {
        const canManage = canEdit(version);
        const sharedBy = canManage ? null : (shared.get(version.id) ?? null);
        const rights: Rights = { canManage, canEdit: canManage || !!sharedBy?.canEdit, sharedBy };
        return [version.id, { ...toDetailItem(version, rights, seesTag), private: privateIds.has(version.id), isFavorite: favorite.has(version.id) }];
      }),
    );
  }

  /** The songs `ids` the user can see, as the library lists them, in that order (issue #81). */
  async listItems(user: AuthenticatedUser, ids: string[]): Promise<ListItem[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.client.songVersion.findMany({
      where: { AND: [await this.access.songsVisibleTo(user), { id: { in: ids } }] },
      select: LIST_SELECT,
    });
    const [seesTag, shared, privateIds] = await Promise.all([this.seesTag(user), this.sharedByOf(user, rows.map((row) => row.id)), this.privateAmong(user, rows)]);
    const byId = new Map(rows.map((row) => [row.id, toListItem(row, seesTag, shared.get(row.id) ?? null, privateIds)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  /**
   * Which of `songs` only `user` can see (issue #172): their personal songs
   * not shared with anyone (a person, a team, an organisation), in no
   * shared songbook, in no team's set nor one shared by link or with
   * guests, and with no submission to the catalogue open.
   */
  private async privateAmong(user: AuthenticatedUser, songs: Pick<ListRow, "id" | "ownerScope" | "ownerUserId">[]): Promise<Set<string>> {
    const own = songs.filter((song) => song.ownerScope === "USER" && song.ownerUserId === user.id).map((song) => song.id);
    if (own.length === 0) return new Set();
    const seen = await this.prisma.client.songVersion.findMany({
      where: {
        id: { in: own },
        OR: [
          { accessGrants: { some: {} } },
          { songbookEntries: { some: { songbook: { shares: { some: {} } } } } },
          { setlistItems: { some: { setlist: { OR: [{ ownerTeamId: { not: null } }, { shareLink: { isNot: null } }, { guests: { some: {} } }] } } } },
          { submissions: { some: { state: { in: [...OPEN_SUBMISSION_STATES] } } } },
        ],
      },
      select: { id: true },
    });
    const shown = new Set(seen.map((row) => row.id));
    return new Set(own.filter((id) => !shown.has(id)));
  }

  /** What `user` may do with the song, and who shared it with them if someone did. */
  private async rightsOn(user: AuthenticatedUser, song: SongVersionOwner & { id: string }): Promise<Rights> {
    const canManage = await this.access.canEdit(user, song);
    const sharedBy = canManage ? null : ((await this.sharedByOf(user, [song.id])).get(song.id) ?? null);
    return { canManage, canEdit: canManage || !!sharedBy?.canEdit, sharedBy };
  }

  /**
   * For songs shared with `user` among `ids`: who by, and whether to edit -
   * shared with one of their teams (issue #331), which team, and to edit
   * only for its admins. A share to them comes first (they can leave it).
   */
  private async sharedByOf(user: AuthenticatedUser, ids: string[]): Promise<Map<string, SharedBy>> {
    if (ids.length === 0) return new Map();
    const memberships = await this.prisma.client.teamMembership.findMany({ where: { userId: user.id }, select: { teamId: true, role: true } });
    const adminOf = new Set(memberships.filter((membership) => membership.role === "ADMIN").map((membership) => membership.teamId));
    const teamIds = memberships.map((membership) => membership.teamId);
    const grants = await this.prisma.client.accessGrant.findMany({
      where: {
        songVersionId: { in: ids },
        OR: [
          { grantedToUserId: user.id },
          { grantedToTeamId: { in: teamIds } },
          // An organisation's (issue #350), for those who don't see the song as theirs or their team's already.
          {
            grantedToOrganization: { memberships: { some: { userId: user.id } } },
            songVersion: { NOT: { OR: [{ ownerScope: "USER", ownerUserId: user.id }, { ownerScope: "TEAM", ownerTeamId: { in: teamIds } }] } },
          },
        ],
      },
      select: {
        songVersionId: true,
        canEdit: true,
        grantedByUser: { select: { id: true, displayName: true } },
        grantedToTeam: { select: { id: true, name: true } },
        grantedToOrganization: { select: { id: true, name: true } },
      },
      // Theirs first, then a team's, then an organisation's (issue #350).
      orderBy: [{ grantedToUserId: { sort: "asc", nulls: "last" } }, { grantedToTeamId: { sort: "asc", nulls: "last" } }],
    });
    const shared = new Map<string, SharedBy>();
    for (const grant of grants) {
      // An organisation's share is to view (issue #350).
      const canEdit = grant.canEdit && !grant.grantedToOrganization && (!grant.grantedToTeam || adminOf.has(grant.grantedToTeam.id));
      const first = shared.get(grant.songVersionId);
      if (first) first.canEdit ||= canEdit;
      else
        shared.set(grant.songVersionId, {
          ...grant.grantedByUser,
          canEdit,
          ...(grant.grantedToTeam && { team: grant.grantedToTeam }),
          ...(grant.grantedToOrganization && { organization: grant.grantedToOrganization }),
        });
    }
    return shared;
  }

  /** The tags `user` sees on a song (see SeesTag). */
  private async seesTag(user: AuthenticatedUser): Promise<SeesTag> {
    const teams = new Set(await this.access.teamIds(user.id));
    return (tag) => tag.scope === "GLOBAL" || (tag.scope === "USER" && tag.ownerUserId === user.id) || (tag.scope === "TEAM" && !!tag.ownerTeamId && teams.has(tag.ownerTeamId));
  }

  /**
   * Names credited on songs the user can see that contain `query` (all of
   * them, for an empty one), with every role they're credited in - for
   * autocompleting artists, composers and lyricists. Names that start with
   * the query come first, then the most credited.
   */
  async searchCredits(user: AuthenticatedUser, query: string): Promise<CreditSuggestion[]> {
    const q = query.trim();
    const songVersion = await this.access.songsVisibleTo(user);
    // Counted in the database, per name and roles: the most credited names
    // containing the query, and separately those starting with it (so a
    // rarer name that starts with it isn't pushed out by commoner ones).
    const credited = (sourceSearch: Prisma.StringNullableFilter<"VersionContributor">) =>
      this.prisma.client.versionContributor.groupBy({
        by: ["source", "roles"],
        // Ignoring accents too (issue #56): sourceSearch is the name without them.
        where: { source: { not: null }, sourceSearch, songVersion },
        _count: { _all: true },
        orderBy: { _count: { source: "desc" } },
        take: 50,
      });
    const folded = q ? await this.unaccent(q) : "";
    const groups = (
      await Promise.all([
        folded ? credited({ startsWith: folded, mode: "insensitive" }) : [],
        credited(folded ? { contains: folded, mode: "insensitive" } : { not: null }),
      ])
    ).flat();
    const byName = new Map<string, CreditSuggestion>();
    const counted = new Set<string>();
    for (const group of groups) {
      const name = group.source!.trim();
      const key = `${group.source}\u0000${group.roles.join()}`;
      if (counted.has(key)) continue;
      counted.add(key);
      const entry = byName.get(name.toLowerCase()) ?? { name, roles: [], songCount: 0 };
      entry.songCount += group._count._all;
      for (const role of group.roles) if (!entry.roles.includes(role)) entry.roles.push(role);
      byName.set(name.toLowerCase(), entry);
    }
    const lower = q.toLowerCase();
    const startsWith = (s: CreditSuggestion) => (lower && s.name.toLowerCase().startsWith(lower) ? 0 : 1);
    return [...byName.values()]
      .sort((a, b) => startsWith(a) - startsWith(b) || b.songCount - a.songCount || a.name.localeCompare(b.name))
      .slice(0, 10);
  }

  /**
   * Songs the user can see with this title (or subtitle), ignoring case -
   * or titled it plus a parenthesised addition, "Amazing Grace (My Chains
   * Are Gone)" - each with every version of it they can see, so adding a
   * song can offer to open one or add another version instead.
   */
  async findMatches(user: AuthenticatedUser, title: string) {
    const t = title.trim();
    if (!t) return [];
    const visible = await this.access.songsVisibleTo(user);
    const matching = await this.prisma.client.songVersion.findMany({
      where: {
        AND: [
          visible,
          {
            OR: [
              { title: { equals: t, mode: "insensitive" } },
              { title: { startsWith: `${t} (`, mode: "insensitive" } },
              { alternateTitle: { equals: t, mode: "insensitive" } },
            ],
          },
        ],
      },
      select: { id: true, workId: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    const workIds = [...new Set(matching.map((v) => v.workId))].slice(0, 5);
    if (workIds.length === 0) return [];
    const versions = await this.prisma.client.songVersion.findMany({
      where: { AND: [visible, { workId: { in: workIds } }] },
      select: MATCH_VERSION_SELECT,
      orderBy: { createdAt: "asc" },
    });
    const matchedIds = new Set(matching.map((v) => v.id));
    return workIds.map((workId) => ({
      workId,
      versions: versions
        .filter((v) => v.workId === workId)
        .sort((a, b) => Number(matchedIds.has(b.id)) - Number(matchedIds.has(a.id)))
        .map(({ documentJson, contributors, ownerTeam, ...rest }) => {
          const key = (documentJson as { defaults?: { key?: unknown } } | null)?.defaults?.key;
          return {
            ...rest,
            teamName: ownerTeam?.name ?? null,
            key: typeof key === "string" && key ? key : null,
            artists: contributors.map((c) => c.source).filter((name): name is string => !!name),
            matchesTitle: matchedIds.has(rest.id),
          };
        }),
    }));
  }

  /** Throws unless every id is a tag the user can use. */
  private async assertTagsUsable(user: AuthenticatedUser, tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return;
    const unique = [...new Set(tagIds)];
    const found = await this.prisma.client.tag.count({ where: { AND: [{ id: { in: unique } }, await this.access.tagsVisibleTo(user)] } });
    if (found !== unique.length) throw new BadRequestException("Unknown tag");
  }

  /**
   * Lists the songbooks this song version is a member of, filtered to
   * what `user` can see - a private songbook's membership (e.g. someone
   * else's personal set list) must never leak through a song that's
   * otherwise publicly visible. See docs/songbooks-and-catalog.md §5.
   */
  async findSongbookMemberships(user: AuthenticatedUser, songVersionId: string) {
    const entries = await this.prisma.client.songbookEntry.findMany({
      where: { songVersionId, songbook: await this.access.songbooksVisibleTo(user) },
      include: { songbook: true },
    });

    return entries
      .map((entry) => {
        const membership = {
          songbookId: entry.songbookId,
          songbookName: entry.songbook.name,
          abbreviation: entry.songbook.abbreviation,
          entryCode: entry.entryCode,
          sectionLabel: computeSectionLabel(entry.entryCode, entry.songbook.sections as SongbookSection[] | null),
        };
        // "JEM 855 · JEM3": to give someone without the app (issue #55).
        return { ...membership, reference: formatSongbookReference(membership) };
      })
      .sort((a, b) => a.songbookName.localeCompare(b.songbookName));
  }

  /**
   * Creates a new Song Version, with its artist(s). Without a `workId`,
   * this also creates a new Work with this version set as its preferred
   * original — a Work has no title of its own (it's just the grouping of
   * versions of "the same song"), so a version is the smallest thing a
   * user can meaningfully create on its own.
   */
  async create(user: AuthenticatedUser, dto: CreateSongVersionDto): Promise<ListItem> {
    let ownerTeamId: string | null = null;
    if (dto.teamId) {
      if (!(await this.access.teamRole(user.id, dto.teamId))) throw new ForbiddenException("Not a member of this team");
      await this.access.assertSongverseTeam(dto.teamId);
      ownerTeamId = dto.teamId;
    }
    const ownerScope = ownerTeamId ? "TEAM" : "USER";
    const owner: SongVersionOwner = { ownerScope, ownerUserId: ownerTeamId ? null : user.id, ownerTeamId };

    let parent: CreateExtras["parent"];
    if (dto.basedOnVersionId) {
      const base = await this.prisma.client.songVersion.findUnique({
        where: { id: dto.basedOnVersionId },
        select: { id: true, workId: true, language: true, ownerScope: true, ownerUserId: true, ownerTeamId: true, publicationState: true },
      });
      if (!base) throw new NotFoundException("Song version not found");
      if (!(await this.access.canSeeSong(user, base))) throw new ForbiddenException("Not visible to you");
      // A song linked to another (issue #78): its translation, or an adaptation in the same language.
      parent = { id: base.id, workId: base.workId, relationshipType: base.language === dto.language ? "LYRICAL_ADAPTATION" : "DIRECT_TRANSLATION" };
    } else if (dto.workId) {
      const work = await this.prisma.client.work.findUnique({ where: { id: dto.workId }, select: { id: true } });
      if (!work) throw new NotFoundException("Work not found");
    }
    if (dto.tagIds) await this.assertTagsUsable(user, dto.tagIds);

    const content = dto.content?.trim() ? dto.content : null;
    const given = chartFrom(dto, []);
    // A whole file read in (issue #203): a section written out again is sung again, and the key and copyright it gives are kept unless set.
    const imported = !given && content ? songFromText(content, dto.contentFormat ?? detectImportFormat(content), { mergeRepeats: true }) : undefined;
    const chart = given ?? imported;
    return this.createVersion(
      owner,
      {
        title: dto.title,
        language: dto.language,
        alternateTitle: dto.alternateTitle,
        versionName: dto.versionName,
        sortTitle: dto.sortTitle,
        album: dto.album,
        year: dto.year,
        copyright: dto.copyright ?? imported?.copyright?.slice(0, 500),
        copyrightYear: dto.copyrightYear,
        publisher: dto.publisher,
        ccli: dto.ccli,
        isrc: dto.isrc,
        reference: dto.reference,
        notes: dto.notes,
      },
      {
        workId: dto.workId,
        parent,
        defaults: { ...(imported?.key && imported.key.length <= 12 && { key: imported.key }), ...defaultsFrom(dto) },
        sections: chart?.sections ?? [],
        flow: chart?.flow,
        capo: dto.capo || null,
        credits: mergeCredits(
          Object.entries(creditListsFrom(dto)).flatMap(([role, names]) => names.map((name) => [name, role as ContributorRole] as const)),
        ),
        tagIds: dto.tagIds ? [...new Set(dto.tagIds)] : [],
        authorUserId: user.id,
      },
    );
  }

  /**
   * A new song from a songbook catalogue entry, under any ownership
   * (including GLOBAL, which the public create() endpoint never lets a
   * caller pick). Used by SongbooksService when materializing a pending
   * catalog entry - see docs/songbooks-and-catalog.md §6 and
   * docs/songbook-catalog-format.md. Every field of the entry is carried
   * over: song fields, key/tempo/time signature/duration on the chart,
   * artists, composers and lyricists as credits (several per field,
   * separated by ";"), tags matching existing ones (the rest are dropped),
   * and - given the song its "Original song" entry became - a place in that
   * song's Work as its translation.
   */
  async createFromCatalogEntry(
    owner: SongVersionOwner,
    entry: CatalogEntryData,
    language: string,
    original: { id: string; workId: string } | null = null,
  ): Promise<ListItem> {
    const timeSignature = parseTimeSignature(entry.timeSignature);
    return this.createVersion(
      owner,
      {
        title: entry.title,
        language,
        alternateTitle: entry.subtitle,
        sortTitle: entry.sortTitle,
        album: entry.album,
        year: entry.year,
        copyright: entry.copyright,
        ccli: entry.ccli,
        isrc: entry.isrc,
        reference: entry.reference,
        notes: entry.notes,
      },
      {
        defaults: {
          ...(entry.key && { key: entry.key }),
          ...(entry.tempo && { tempo: entry.tempo }),
          ...(timeSignature && { timeSignature }),
          ...(entry.durationSeconds && { durationSeconds: entry.durationSeconds }),
        },
        credits: mergeCredits([
          ...splitNames(entry.artist).map((name) => [name, "PERFORMER"] as const),
          ...splitNames(entry.composer).map((name) => [name, "COMPOSER"] as const),
          ...splitNames(entry.lyricist).map((name) => [name, "LYRICIST"] as const),
        ]),
        tagIds: await this.matchTagIds(owner, entry.tags),
        links: entry.links,
        parent: original ? { ...original, relationshipType: "DIRECT_TRANSLATION" } : undefined,
      },
    );
  }

  /**
   * Ids of the existing tags the owner can use whose name - English label,
   * slug, or any translation - matches one of `names`, ignoring case and
   * accents. Names with no such tag are dropped.
   */
  private async matchTagIds(owner: SongVersionOwner, names: string[]): Promise<string[]> {
    if (names.length === 0) return [];
    const tags = await this.prisma.client.tag.findMany({
      where: {
        OR: [
          { scope: "GLOBAL", isApproved: true },
          ...(owner.ownerUserId ? [{ scope: "USER" as const, ownerUserId: owner.ownerUserId }] : []),
          ...(owner.ownerTeamId ? [{ scope: "TEAM" as const, ownerTeamId: owner.ownerTeamId }] : []),
        ],
      },
      select: { id: true, label: true, slug: true, translations: true },
    });
    const byName = new Map<string, string>();
    for (const tag of tags) {
      const translations = tag.translations && typeof tag.translations === "object" ? Object.values(tag.translations) : [];
      for (const name of [tag.label, tag.slug.replace(/-/g, " "), ...translations]) {
        if (typeof name === "string" && !byName.has(foldName(name))) byName.set(foldName(name), tag.id);
      }
    }
    return [...new Set(names.map((name) => byName.get(foldName(name))).filter((id): id is string => !!id))];
  }

  private buildVersionData(
    owner: SongVersionOwner,
    fields: VersionFields,
    defaults: SongDefaultsV2 = {},
    sections: SongDocumentV2["sections"] = [],
    capo: number | null = null,
    flow?: SongDocumentV2["flow"],
  ) {
    const documentJson: SongDocumentV2 = parseSongDocumentV2({
      $schema: "song-document/v2",
      revision: 1,
      defaults,
      sections,
      flow: flow ?? sections.map((section) => ({ id: flowItemId(section.id), sectionId: section.id })),
    });

    return {
      ...owner,
      title: fields.title,
      alternateTitle: fields.alternateTitle ?? null,
      versionName: fields.versionName ?? null,
      sortTitle: fields.sortTitle ?? null,
      language: fields.language,
      album: fields.album ?? null,
      year: fields.year ?? null,
      copyright: fields.copyright ?? null,
      copyrightYear: fields.copyrightYear ?? null,
      publisher: fields.publisher ?? null,
      ccli: fields.ccli ?? null,
      isrc: fields.isrc ?? null,
      reference: fields.reference ?? null,
      notes: fields.notes ?? null,
      capo,
      documentJson: documentJson as object,
      // Its words, as a lyrics search finds them (issue #221).
      lyricsText: lyricsSearchText(documentJson),
    };
  }

  /**
   * One transaction: the version, in a new Work (or `workId`'s, or as
   * `parent`'s derived version in its Work), with its credits and tags.
   */
  private async createVersion(owner: SongVersionOwner, fields: VersionFields, extras: CreateExtras = {}): Promise<ListItem> {
    const versionData = this.buildVersionData(owner, fields, extras.defaults, extras.sections, extras.capo ?? null, extras.flow);
    const version = await this.prisma.client.$transaction(async (tx) => {
      const existingWorkId = extras.parent?.workId ?? extras.workId;
      const workId = existingWorkId ?? (await tx.work.create({ data: {} })).id;
      const created = await tx.songVersion.create({
        data: {
          ...versionData,
          workId,
          ...(extras.parent && { parentVersionId: extras.parent.id, relationshipType: extras.parent.relationshipType }),
        },
        select: { id: true },
      });
      if (extras.credits?.length) {
        await tx.versionContributor.createMany({
          data: extras.credits.map((credit, displayOrder) => ({ songVersionId: created.id, source: credit.source, roles: credit.roles, displayOrder })),
        });
      }
      if (extras.tagIds?.length) {
        await tx.songVersionTag.createMany({ data: extras.tagIds.map((tagId) => ({ songVersionId: created.id, tagId })) });
      }
      const links = new Map<StreamingIdentifierType, { value: string; sourceUrl: string }>();
      for (const url of extras.links ?? []) {
        const link = readReferenceLink(url);
        if (link && link.service !== "OTHER" && link.value && !links.has(link.service)) links.set(link.service, { value: link.value, sourceUrl: link.url });
      }
      if (links.size > 0) {
        await tx.songVersionIdentifier.createMany({ data: [...links].map(([type, link]) => ({ songVersionId: created.id, type, ...link })) });
      }
      if (!existingWorkId) {
        await tx.work.update({ where: { id: workId }, data: { preferredOriginalVersionId: created.id } });
      }
      await this.history.record(tx, created.id, { kind: "CREATED", authorUserId: extras.authorUserId ?? null });
      return tx.songVersion.findUniqueOrThrow({ where: { id: created.id }, select: LIST_SELECT });
    });
    return toListItem(version);
  }

  /**
   * Partial update, in one transaction. Given, the artist, composer and
   * lyricist lists replace those credits, tagIds the tags, and content the
   * chart (empty content clears it) - parsed from text, keeping the IDs of
   * everything still there (see reconcileSections) - or `sections` and/or
   * `flow` the chart as the structured editor saves it, IDs as they are. Key, tempo, time
   * signature and duration live in the document; the rest are columns.
   *
   * `revision` is the document revision the editor started from: if the
   * song was saved since (another tab, another admin), the save is refused
   * rather than overwriting their changes.
   */
  async update(user: AuthenticatedUser, id: string, dto: UpdateSongVersionDto): Promise<DetailItem> {
    const prepared = await this.prepareUpdate(user, id, dto);
    const version = await this.prisma.client.$transaction(async (tx) => {
      const before = await this.history.before(tx, id);
      await this.writeUpdate(tx, user, id, dto, prepared);
      await this.history.record(tx, id, { kind: "EDITED", authorUserId: user.id, before });
      return tx.songVersion.findUniqueOrThrow({ where: { id }, select: DETAIL_SELECT });
    });
    return toDetailItem(version, await this.rightsOn(user, version), await this.seesTag(user));
  }

  /**
   * The song as it is, and as `dto` would leave it, without saving it (a
   * suggestion, issue #74): the same save, rolled back. Tags aren't part
   * of it.
   */
  async previewUpdate(user: AuthenticatedUser, id: string, dto: UpdateSongVersionDto): Promise<{ before: SongSnapshot; after: SongSnapshot }> {
    const change = { ...dto, tagIds: undefined };
    const prepared = await this.prepareUpdate(user, id, change);
    try {
      await this.prisma.client.$transaction(async (tx) => {
        const before = await this.history.before(tx, id);
        await this.writeUpdate(tx, user, id, change, prepared);
        const after = await this.history.before(tx, id);
        throw new Preview({ before: before!.snapshot, after: after!.snapshot });
      });
    } catch (error) {
      if (error instanceof Preview) return error.result;
      throw error;
    }
    throw new Error("unreachable");
  }

  /**
   * Saves `snapshot` as the song's chart, details and credits, with the
   * history entry credited to `authorUserId` - an accepted suggestion
   * (issue #74). Refused if the song moved on since `expected` was read.
   */
  async saveSnapshot(user: AuthenticatedUser, id: string, snapshot: SongSnapshot, authorUserId: string, expected: SongSnapshot): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const before = await this.history.before(tx, id);
      if (!before) throw new NotFoundException("Song version not found");
      if (snapshotChanges(expected, before.snapshot).length > 0) throw staleRevision();
      await this.writeSnapshot(tx, id, snapshot);
      await this.history.record(tx, id, { kind: "EDITED", authorUserId, before });
    });
  }

  /** Checks an update and works out its chart, before it's written. */
  /** `user` is null for the Worker's own changes (issue #352), which never touch tags. */
  private async prepareUpdate(user: AuthenticatedUser | null, id: string, dto: UpdateSongVersionDto) {
    const existing = await this.prisma.client.songVersion.findUnique({
      where: { id },
      select: { documentJson: true },
    });
    if (!existing) throw new NotFoundException("Song version not found");
    if (dto.tagIds && user) await this.assertTagsUsable(user, dto.tagIds);

    const previous = readSongDocument(existing.documentJson);
    if (dto.revision !== undefined && dto.revision !== previous.revision) throw staleRevision();
    const defaults = defaultsFrom(dto);
    const chart = chartFrom(dto, previous.sections);
    const touchesDocument = dto.content !== undefined || chart !== undefined || Object.keys(defaults).length > 0;
    const content = dto.content?.trim() ? dto.content : "";
    const documentJson = !touchesDocument
      ? null
      : chart
        ? songDocumentFromSections(previous, { ...chart, defaults })
        : songDocumentFromText(previous, {
            content: dto.content === undefined ? undefined : content,
            format: dto.contentFormat ?? detectImportFormat(content),
            defaults,
          });
    return { stored: existing.documentJson, documentJson };
  }

  /** Writes a prepared update: undefined leaves a column alone; null clears it. */
  private async writeUpdate(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser | null,
    id: string,
    dto: UpdateSongVersionDto,
    { stored, documentJson }: Awaited<ReturnType<SongVersionsService["prepareUpdate"]>>,
  ) {
    if (documentJson) await this.writeDocument(tx, id, stored, documentJson);
    await tx.songVersion.update({
      where: { id },
      data: {
        title: dto.title,
        alternateTitle: dto.alternateTitle,
        versionName: dto.versionName,
        sortTitle: dto.sortTitle,
        language: dto.language,
        album: dto.album,
        year: dto.year,
        ccli: dto.ccli,
        isrc: dto.isrc,
        copyright: dto.copyright,
        copyrightYear: dto.copyrightYear,
        publisher: dto.publisher,
        reference: dto.reference,
        notes: dto.notes,
        ...(dto.capo !== undefined && { capo: dto.capo || null }),
      },
    });
    await replaceCredits(tx, id, creditListsFrom(dto));
    if (dto.tagIds && user) {
      const tagIds = [...new Set(dto.tagIds)];
      // Others' own tags on the song (a catalogue song's contributor's, #73) aren't this user's to remove.
      await tx.songVersionTag.deleteMany({
        where: { songVersionId: id, tagId: { notIn: tagIds }, tag: tagsVisibleWhere(user.id, await this.access.teamIds(user.id)) },
      });
      await tx.songVersionTag.createMany({ data: tagIds.map((tagId) => ({ songVersionId: id, tagId })), skipDuplicates: true });
    }
  }

  /**
   * Puts the song back as a history entry left it (issue #71): its chart
   * (IDs as they were, so arrangements pointing at them find them again),
   * details and credits, as a new save - itself an entry, so a restore can
   * be undone. Tags, files and links aren't touched.
   */
  async restore(user: AuthenticatedUser, id: string, revisionId: string): Promise<DetailItem> {
    const snapshot: SongSnapshot = await this.history.snapshotToRestore(id, revisionId);
    const version = await this.prisma.client.$transaction(async (tx) => {
      const before = await this.history.before(tx, id);
      await this.writeSnapshot(tx, id, snapshot);
      await this.history.record(tx, id, { kind: "RESTORED", authorUserId: user.id, before, restoredFromId: revisionId });
      return tx.songVersion.findUniqueOrThrow({ where: { id }, select: DETAIL_SELECT });
    });
    return toDetailItem(version, await this.rightsOn(user, version), await this.seesTag(user));
  }

  /**
   * Writes a history snapshot back: its chart (IDs as they were), details
   * and credits, as a new revision of the document. Tags, files and links
   * aren't touched.
   */
  private async writeSnapshot(tx: Prisma.TransactionClient, id: string, snapshot: SongSnapshot) {
    const existing = await tx.songVersion.findUniqueOrThrow({ where: { id }, select: { documentJson: true } });
    const current = readSongDocument(existing.documentJson);
    const next = parseSongDocumentV2({
      ...songDocumentFromSections(current, { sections: snapshot.chart.sections, flow: snapshot.chart.flow }),
      defaults: snapshot.chart.defaults,
    });
    await this.writeDocument(tx, id, existing.documentJson, next);
    const { capo, ...details } = snapshot.details;
    await tx.songVersion.update({ where: { id }, data: { ...details, capo } });
    // Every role, so one the song has now but didn't then is cleared.
    const currentRoles = await tx.versionContributor.findMany({ where: { songVersionId: id }, select: { roles: true } });
    const roles = new Set<ContributorRole>([
      ...currentRoles.flatMap((row) => row.roles),
      ...snapshot.credits.flatMap((credit) => credit.roles as ContributorRole[]),
    ]);
    await replaceCredits(
      tx,
      id,
      Object.fromEntries([...roles].map((role) => [role, snapshot.credits.filter((c) => c.roles.includes(role)).map((c) => c.name)])),
    );
  }

  /**
   * Stores `next` in place of `stored`, but only if nobody else saved in
   * between: the write is conditional on the stored revision (a document
   * without one is matched as it was).
   */
  private async writeDocument(tx: Prisma.TransactionClient, id: string, stored: Prisma.JsonValue, next: SongDocumentV2) {
    const storedRevision = (stored as { revision?: unknown } | null)?.revision;
    const where: Prisma.SongVersionWhereInput =
      typeof storedRevision === "number"
        ? { id, documentJson: { path: ["revision"], equals: storedRevision } }
        : { id, documentJson: { equals: stored as Prisma.InputJsonValue } };
    const { count } = await tx.songVersion.updateMany({ where, data: { documentJson: next as object, lyricsText: lyricsSearchText(next) } });
    if (count === 0) throw staleRevision();
  }

  /**
   * Replaces this version's content with the result of parsing an uploaded
   * file (bulk upload), keeping IDs where the content is unchanged: a section
   * written out again is sung again (issue #203), and the key and copyright
   * the file gives fill the song's only where it has none. Everything else
   * is left untouched.
   */
  async importText(id: string, content: string, format: SupportedImportFormat, authorUserId: string | null = null): Promise<void> {
    const existing = await this.prisma.client.songVersion.findUnique({
      where: { id },
      select: { documentJson: true, copyright: true },
    });
    if (!existing) throw new NotFoundException("Song version not found");

    const previous = readSongDocument(existing.documentJson);
    const read = songFromText(content, format);
    const documentJson = songDocumentFromText(previous, {
      content,
      format,
      mergeRepeats: true,
      ...(!previous.defaults.key && read.key && read.key.length <= 12 && { defaults: { key: read.key } }),
    });
    await this.prisma.client.$transaction(async (tx) => {
      const before = await this.history.before(tx, id);
      await this.writeDocument(tx, id, existing.documentJson, documentJson);
      if (!existing.copyright?.trim() && read.copyright) await tx.songVersion.update({ where: { id }, data: { copyright: read.copyright.slice(0, 500) } });
      await this.history.record(tx, id, { kind: "EDITED", authorUserId, before });
    });
    // Nothing returned: its caller is the Worker's bulk upload (issue #92), which runs without
    // BETTER_AUTH_SECRET - the song's details would sign its image's address with it.
  }

  /** A ChordPro file of the song: its details from the columns, then the chart. */
  async exportChordPro(id: string): Promise<string> {
    const version = await this.prisma.client.songVersion.findUnique({
      where: { id },
      select: {
        title: true,
        alternateTitle: true,
        album: true,
        year: true,
        copyright: true,
        ccli: true,
        capo: true,
        documentJson: true,
        contributors: { select: { source: true, roles: true }, orderBy: { displayOrder: "asc" } },
      },
    });
    if (!version) throw new NotFoundException("Song version not found");
    const credited = (role: ContributorRole) =>
      version.contributors.filter((c) => c.source && c.roles.includes(role)).map((c) => c.source!);
    return songToChordPro(readSongDocument(version.documentJson), {
      title: version.title,
      subtitle: version.alternateTitle,
      artists: credited("PERFORMER"),
      composers: credited("COMPOSER"),
      lyricists: credited("LYRICIST"),
      album: version.album,
      year: version.year,
      copyright: version.copyright,
      ccli: version.ccli,
      capo: version.capo,
    });
  }

  async setStreamingLink(songVersionId: string, type: StreamingIdentifierType, url: string) {
    const { value, sourceUrl } = parseStreamingLink(type, url);
    return this.prisma.client.songVersionIdentifier.upsert({
      where: { songVersionId_type: { songVersionId, type } },
      create: { songVersionId, type, value, sourceUrl, verifiedAt: null },
      update: { value, sourceUrl, verifiedAt: null },
      select: { id: true, type: true, value: true, sourceUrl: true },
    });
  }

  async removeStreamingLink(songVersionId: string, type: StreamingIdentifierType): Promise<void> {
    await this.prisma.client.songVersionIdentifier.deleteMany({ where: { songVersionId, type } });
  }

  /**
   * Links the song info chosen in Auto detect (issue #22), looked up again
   * from its sources: kept with the song, its artist added (see
   * replaceAutoAttachedArtist), its Apple Music and Deezer tracks as the
   * song's streaming links where it has none, and its release's artwork
   * as the song's image - unless `artwork` is false (issue #352: the
   * review left the song's own).
   */
  async linkMetadata(songVersionId: string, sources: Pick<MetadataSource, "provider" | "id">[], { artwork = true }: { artwork?: boolean } = {}): Promise<MetadataMatch> {
    const match = await this.metadata.lookup(sources);
    await this.saveMetadataLink(songVersionId, match, { artwork });
    return match;
  }

  /** Keeps a looked-up match with the song (see linkMetadata). Returns nothing: the Worker calls it too. */
  async saveMetadataLink(songVersionId: string, match: MetadataMatch, { artwork }: { artwork: boolean }): Promise<void> {
    const [first] = match.sources;
    const musicBrainz = match.sources.find((source) => source.provider === "musicbrainz");
    await this.prisma.client.$transaction(async (tx) => {
      const details = match as unknown as Prisma.InputJsonValue;
      const value = `${first!.provider}:${first!.id}`;
      await tx.songVersionIdentifier.upsert({
        where: { songVersionId_type: { songVersionId, type: "METADATA_MATCH" } },
        create: { songVersionId, type: "METADATA_MATCH", value, sourceUrl: first!.url, verifiedAt: new Date(), details },
        update: { value, sourceUrl: first!.url, verifiedAt: new Date(), details },
      });
      // The MusicBrainz recording, as its own identifier - or none, when the new match isn't one.
      if (musicBrainz) {
        const data = { value: musicBrainz.id, sourceUrl: musicBrainz.url, verifiedAt: new Date(), details };
        await tx.songVersionIdentifier.upsert({
          where: { songVersionId_type: { songVersionId, type: "MUSICBRAINZ_RECORDING" } },
          create: { songVersionId, type: "MUSICBRAINZ_RECORDING", ...data },
          update: data,
        });
      } else await tx.songVersionIdentifier.deleteMany({ where: { songVersionId, type: "MUSICBRAINZ_RECORDING" } });
      for (const source of match.sources) {
        const type = STREAMING_TYPE_OF[source.provider];
        if (!type) continue;
        const existing = await tx.songVersionIdentifier.findUnique({ where: { songVersionId_type: { songVersionId, type } }, select: { id: true } });
        if (!existing) await tx.songVersionIdentifier.create({ data: { songVersionId, type, value: source.id, sourceUrl: source.url } });
      }
      await replaceAutoAttachedArtist(tx, songVersionId, match.artist);
    });
    if (artwork && match.artworkUrl && (await this.artwork.settings()).enabled) {
      await this.artwork.setFromUrl(songVersionId, match.artworkUrl).catch((err: Error) => this.logger.warn(`No artwork from the match for ${songVersionId}: ${err.message}`));
    }
  }

  /** The song as it is, for what a match would change (issue #352). */
  async songInfoOf(id: string): Promise<SongInfoCurrent> {
    const version = await this.prisma.client.songVersion.findUnique({
      where: { id },
      select: { title: true, album: true, year: true, isrc: true, imageStorageKey: true, documentJson: true, contributors: { select: { source: true, roles: true }, orderBy: { displayOrder: "asc" } } },
    });
    if (!version) throw new NotFoundException("Song version not found");
    const defaults = readSongDocument(version.documentJson).defaults;
    const named = (roles: ContributorRole[]) => version.contributors.filter((c) => c.source && c.roles.some((role) => roles.includes(role))).map((c) => c.source!);
    return {
      title: version.title,
      artists: named(["PERFORMER"]),
      writers: named(["AUTHOR", "COMPOSER", "LYRICIST"]),
      album: version.album,
      year: version.year,
      isrc: version.isrc,
      tempo: defaults.tempo ?? null,
      durationSeconds: defaults.durationSeconds ?? null,
      hasImage: !!version.imageStorageKey,
    };
  }

  /**
   * Fills what the song doesn't have from `match` (issue #352, bulk
   * imports): only empty fields, never its title, as one save in its
   * history credited to `authorUserId`. The artwork is the link's (see
   * saveMetadataLink). Returns the fields filled - nothing signed: the
   * Worker calls it.
   */
  async fillFromMatch(id: string, match: MetadataMatch, authorUserId: string | null): Promise<SongInfoField[]> {
    const fields = songInfoProposals(await this.songInfoOf(id), match)
      .filter((p) => p.fillsEmpty && p.field !== "title" && p.field !== "artwork")
      .map((p) => p.field);
    return this.applyFromMatch(id, match, fields, authorUserId);
  }

  /**
   * Writes the fields chosen of what `match` would change (issue #353: a
   * songbook's refresh, reviewed), worked out against the song as it is
   * now: one save in its history, credited to `authorUserId`. Writers
   * chosen take the place of who it credited with writing it. The artwork
   * isn't written here (see saveMetadataLink). Returns the fields written.
   */
  async applyFromMatch(id: string, match: MetadataMatch, fields: SongInfoField[], authorUserId: string | null): Promise<SongInfoField[]> {
    const wanted = new Set(fields);
    const chosen = songInfoProposals(await this.songInfoOf(id), match).filter((p) => wanted.has(p.field) && p.field !== "artwork");
    if (chosen.length === 0) return [];
    const dto: Record<string, unknown> = {};
    for (const { field, proposed } of chosen) {
      dto[field === "duration" ? "durationSeconds" : field] = proposed;
      if (field === "writers") Object.assign(dto, { composers: [], lyricists: [] });
    }
    const change = dto as UpdateSongVersionDto;
    const prepared = await this.prepareUpdate(null, id, change);
    await this.prisma.client.$transaction(async (tx) => {
      const before = await this.history.before(tx, id);
      await this.writeUpdate(tx, null, id, change, prepared);
      await this.history.record(tx, id, { kind: "EDITED", authorUserId, before });
    });
    return chosen.map((p) => p.field);
  }

  /** Unlinks it (and its MusicBrainz recording, and artist); the streaming links and image stay. */
  async unlinkMetadata(songVersionId: string) {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.songVersionIdentifier.deleteMany({ where: { songVersionId, type: { in: ["METADATA_MATCH", "MUSICBRAINZ_RECORDING"] } } });
      await replaceAutoAttachedArtist(tx, songVersionId, null);
    });
  }

  /**
   * The linked song info, as saved when it was linked - no lookup, so
   * showing a song never waits on a provider. A song linked to MusicBrainz
   * the old way shows what its recording kept; one that kept nothing has
   * its song info saved by the Worker's backfill (issue #116), not here.
   */
  async getMetadataMatch(songVersionId: string): Promise<MetadataMatch | null> {
    const identifiers = await this.prisma.client.songVersionIdentifier.findMany({
      where: { songVersionId, type: { in: ["METADATA_MATCH", "MUSICBRAINZ_RECORDING"] } },
    });
    const linked = identifiers.find((identifier) => identifier.type === "METADATA_MATCH");
    const saved = linked && MetadataMatchSchema.safeParse(linked.details);
    if (saved?.success) return saved.data;
    const recording = identifiers.find((identifier) => identifier.type === "MUSICBRAINZ_RECORDING");
    if (!recording) return null;
    const legacy = MusicBrainzRecordingMatchSchema.safeParse(recording.details);
    return legacy.success && legacy.data.mbid === recording.value ? recordingAsMatch(legacy.data) : null;
  }
}

/** Carries a previewed update out of the transaction it rolls back. */
class Preview extends Error {
  constructor(readonly result: { before: SongSnapshot; after: SongSnapshot }) {
    super("preview");
  }
}
