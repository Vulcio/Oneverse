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
  readSongDocument,
  safeParseSongDocumentV2,
  snapshotChanges,
  songDocumentFromSections,
  songDocumentFromText,
  songFromText,
  songToChordPro,
  splitNames,
  type CatalogEntryData,
  type MetadataMatch,
  type MetadataSource,
  type MusicBrainzRecordingMatch,
  type SongbookSection,
  type SongDefaultsV2,
  type SongDocumentV2,
  type SongSnapshot,
  type StreamingIdentifierType,
  type SupportedImportFormat,
  type SongFields,
  findProgression,
  lyricsLines,
  lyricsSearchText,
  matchLyrics,
  parseLyricsQuery,
  type LyricsMatch,
  parseProgressionQuery,
  progressionGrams,
  progressionSimilarity,
  songProgressions,
  type SectionProgression,
} from "@oneverse/core";
import type { ContributorRole, Prisma, VersionRelationshipType } from "@oneverse/db";
import { MusicBrainzService } from "../musicbrainz/musicbrainz.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AccessPolicyService, OPEN_SUBMISSION_STATES } from "../access/access-policy.service.js";
import { songbookReferencesOf } from "../songbooks/songbook-references.js";
import { setOrder } from "../common/utils/set-order.js";
import { SetlistAccessService } from "../setlists/setlist-access.service.js";
import { songSearchWhere } from "./song-search.js";
import type { CreateSongVersionDto } from "./dto/create-song-version.dto.js";
import type { ListSongVersionsQueryDto } from "./dto/list-song-versions-query.dto.js";
import type { UpdateSongVersionDto } from "./dto/update-song-version.dto.js";
import { ArtistsService, artistKey } from "../artists/artists.service.js";
import { ArtworkService } from "../artwork/artwork.service.js";
import { songImageUrl } from "../artwork/song-image-url.js";
import { MetadataService } from "../metadata/metadata.service.js";
import { StorageService } from "../storage/storage.service.js";
import { SongHistoryService } from "./song-history.service.js";

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
  /** Add to this existing Work. */
  workId?: string;
  /** Derived from this version (e.g. a translation of it): joins its Work. */
  parent?: { id: string; workId: string; relationshipType: VersionRelationshipType };
  /** Who made it, for its history. */
  authorUserId?: string;
};

/** One credit per person (ignoring case), with all their roles. */
function mergeCredits(entries: readonly (readonly [string, ContributorRole])[]): { source: string; roles: ContributorRole[] }[] {
  const credits: { source: string; roles: ContributorRole[] }[] = [];
  for (const [name, role] of entries) {
    const existing = credits.find((credit) => credit.source.toLowerCase() === name.toLowerCase());
    if (!existing) credits.push({ source: name, roles: [role] });
    else if (!existing.roles.includes(role)) existing.roles.push(role);
  }
  return credits;
}

/**
 * Swaps the artist a MusicBrainz link added (isAutoAttached) for `artist`
 * - or removes it, for null. A previous link's row is replaced so
 * re-linking doesn't leave the old artist alongside the new one, and rows
 * added by hand (a composer, say) aren't touched. Two rules on top: no
 * second copy of an artist the song already credits, and a song never
 * ends up with no artist - the old one is then kept, as an ordinary one.
 */
async function replaceAutoAttachedArtist(tx: Prisma.TransactionClient, songVersionId: string, artist: string | null): Promise<void> {
  const performers = await tx.versionContributor.findMany({
    where: { songVersionId, roles: { has: "PERFORMER" } },
    select: { id: true, source: true, isAutoAttached: true },
  });
  const manual = performers.filter((p) => !p.isAutoAttached);
  const auto = performers.filter((p) => p.isAutoAttached);
  const same = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();

  if (artist && !manual.some((p) => same(p.source, artist))) {
    if (auto.length === 1 && same(auto[0]!.source, artist)) return;
    await tx.versionContributor.deleteMany({ where: { songVersionId, isAutoAttached: true } });
    await tx.versionContributor.create({ data: { songVersionId, userId: null, source: artist, roles: ["PERFORMER"], isAutoAttached: true } });
    return;
  }
  if (manual.length > 0 || auto.length === 0) {
    await tx.versionContributor.deleteMany({ where: { songVersionId, isAutoAttached: true } });
    return;
  }
  // The link's artist is the only one: keep it, now as the song's own.
  await tx.versionContributor.updateMany({ where: { songVersionId, isAutoAttached: true }, data: { isAutoAttached: false } });
}

/** The chart's defaults a DTO sets (undefined leaves one alone, null clears it). */
function defaultsFrom(dto: SongFields): SongDefaultsV2 {
  return {
    ...(dto.key !== undefined && { key: dto.key }),
    ...(dto.tempo !== undefined && { tempo: dto.tempo }),
    ...(dto.timeSignature !== undefined && { timeSignature: parseTimeSignature(dto.timeSignature) }),
    ...(dto.durationSeconds !== undefined && { durationSeconds: dto.durationSeconds }),
  };
}

/** The credits a DTO lists, by role; roles it leaves out aren't there. */
function creditListsFrom(dto: SongFields & { artists?: string[] }): Partial<Record<ContributorRole, string[]>> {
  return {
    ...(dto.artists && { PERFORMER: dto.artists }),
    ...(dto.composers && { COMPOSER: dto.composers }),
    ...(dto.lyricists && { LYRICIST: dto.lyricists }),
    ...(dto.writers && { AUTHOR: dto.writers }),
    ...(dto.arrangers && { ARRANGER: dto.arrangers }),
    ...(dto.translators && { TRANSLATOR: dto.translators }),
    ...(dto.adaptors && { ADAPTOR: dto.adaptors }),
  };
}

/**
 * Makes `lists[role]` exactly who the song credits in each listed role,
 * leaving other roles alone: a person keeps one row with all their roles
 * (a composer who's also the lyricist), rows left with no role go, and
 * artists come first, in the order given.
 */
async function replaceCredits(
  tx: Prisma.TransactionClient,
  songVersionId: string,
  lists: Partial<Record<ContributorRole, string[]>>,
): Promise<void> {
  const roles = Object.keys(lists) as ContributorRole[];
  if (roles.length === 0) return;
  const wanted = new Map<string, { name: string; roles: ContributorRole[] }>();
  for (const role of roles) {
    for (const name of lists[role] ?? []) {
      const entry = wanted.get(name.toLowerCase()) ?? { name, roles: [] };
      if (!entry.roles.includes(role)) entry.roles.push(role);
      wanted.set(name.toLowerCase(), entry);
    }
  }

  const rows = await tx.versionContributor.findMany({
    where: { songVersionId },
    select: { id: true, source: true, roles: true },
    orderBy: { displayOrder: "asc" },
  });
  // `id` is null for the people added now.
  const kept: { id: string | null; source: string | null; roles: ContributorRole[] }[] = [];
  const removed: string[] = [];
  for (const row of rows) {
    const nextRoles = row.roles.filter((role) => !roles.includes(role));
    const match = row.source ? wanted.get(row.source.toLowerCase()) : undefined;
    if (match) {
      nextRoles.push(...match.roles.filter((role) => !nextRoles.includes(role)));
      wanted.delete(row.source!.toLowerCase());
    }
    if (nextRoles.length === 0) {
      removed.push(row.id);
      continue;
    }
    if (nextRoles.length !== row.roles.length || nextRoles.some((role) => !row.roles.includes(role))) {
      await tx.versionContributor.update({ where: { id: row.id }, data: { roles: nextRoles } });
    }
    kept.push({ id: row.id, source: row.source, roles: nextRoles });
  }
  for (const entry of wanted.values()) kept.push({ id: null, source: entry.name, roles: entry.roles });

  const artistOrder = (lists.PERFORMER ?? []).map((name) => name.toLowerCase());
  const rank = (row: (typeof kept)[number]) => {
    const index = row.source ? artistOrder.indexOf(row.source.toLowerCase()) : -1;
    return row.roles.includes("PERFORMER") ? (index === -1 ? artistOrder.length : index) : artistOrder.length + 1;
  };
  const ordered = kept
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map(({ row }, order) => ({ ...row, order }));

  if (removed.length > 0) await tx.versionContributor.deleteMany({ where: { id: { in: removed } } });
  await tx.versionContributor.createMany({
    data: ordered
      .filter((row) => row.id === null)
      .map((row) => ({ songVersionId, userId: null, source: row.source, roles: row.roles, displayOrder: row.order })),
  });
  await setOrder(
    tx,
    "VersionContributor",
    ordered.flatMap(({ id, order }) => (id ? [{ id, order }] : [])),
  );
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

const LIST_SELECT = {
  id: true,
  workId: true,
  title: true,
  alternateTitle: true,
  versionName: true,
  language: true,
  ownerScope: true,
  ownerUserId: true,
  ownerTeamId: true,
  publicationState: true,
  ccli: true,
  createdAt: true,
  updatedAt: true,
  // Its image (issue #85): handed out as a signed address, never the key itself.
  imageStorageKey: true,
  // Who put it in the catalogue (issue #73).
  contributedBy: { select: { id: true, displayName: true } },
  contributedByTeam: { select: { id: true, name: true } },
  // Just the artist(s) — enough for the library list to show "Title —
  // Artist" without pulling in the full contributor list (composer,
  // lyricist, etc.), which only the detail page needs.
  contributors: {
    where: { roles: { has: "PERFORMER" as ContributorRole } },
    select: { id: true, userId: true, source: true },
    orderBy: { displayOrder: "asc" },
  },
  versionTags: {
    select: {
      id: true,
      tag: { select: { id: true, categoryId: true, slug: true, label: true, translations: true, scope: true, ownerUserId: true, ownerTeamId: true } },
    },
  },
} satisfies Prisma.SongVersionSelect;

const STREAMING_IDENTIFIER_TYPES = ["SPOTIFY", "APPLE_MUSIC", "DEEZER", "YOUTUBE"] as const;
/** The streaming link a metadata provider's track is (issue #22). */
const STREAMING_TYPE_OF: Partial<Record<MetadataSource["provider"], (typeof STREAMING_IDENTIFIER_TYPES)[number]>> = { apple_music: "APPLE_MUSIC", deezer: "DEEZER", spotify: "SPOTIFY" };

export interface SongVersionOwner {
  ownerScope: "GLOBAL" | "TEAM" | "USER";
  ownerUserId: string | null;
  ownerTeamId: string | null;
}

const DETAIL_SELECT = {
  ...LIST_SELECT,
  sortTitle: true,
  album: true,
  year: true,
  copyright: true,
  copyrightYear: true,
  publisher: true,
  isrc: true,
  reference: true,
  notes: true,
  relationshipType: true,
  // The version this one derives from (e.g. the original of a translation).
  parentVersion: { select: { id: true, title: true, language: true } },
  documentJson: true,
  capo: true,
  contributors: {
    select: { id: true, userId: true, source: true, roles: true, isAutoAttached: true, displayOrder: true },
    orderBy: { displayOrder: "asc" },
  },
  // CCLI has its own column and the song info match its own endpoint -
  // this is just the plain "links" (Spotify/Apple Music/Deezer/YouTube/custom),
  // which have nothing more to fetch than what's stored.
  identifiers: {
    where: { type: { in: [...STREAMING_IDENTIFIER_TYPES, "CUSTOM"] } },
    select: { id: true, type: true, value: true, sourceUrl: true },
  },
} satisfies Prisma.SongVersionSelect;

type ListRow = Prisma.SongVersionGetPayload<{ select: typeof LIST_SELECT }>;
/** One page of a song list, with the total across all pages. */
export interface SongPage {
  items: ListItem[];
  total: number;
  page: number;
  pageSize: number;
}
export type ListItem = Omit<ListRow, "contributors" | "versionTags" | "imageStorageKey"> & {
  /** The song's image, signed for the viewer (issue #85); null when it has none. */
  imageUrl: string | null;
  artists: ListRow["contributors"];
  tags: ListRow["versionTags"][number]["tag"][];
  /** Shared with the viewer by its owner (issue #77). */
  sharedBy: SharedBy | null;
  /** Only the viewer can see it (issue #172): theirs, shared with nobody, in no team's or shared set, not sent to the catalogue. */
  private?: boolean;
  /** Where it is in the viewer's numbered songbooks, when asked (issue #213). */
  songbookReferences?: string[];
  /** Found by its words (issue #221): the line, and the words in it. */
  lyricsMatch?: LyricsMatch;
};

type TagRow = ListRow["versionTags"][number]["tag"];
/** Which of a song's tags a viewer sees: global ones, their own and their teams' (a catalogue song keeps its contributor's, #73). */
type SeesTag = (tag: Pick<TagRow, "scope" | "ownerUserId" | "ownerTeamId">) => boolean;
const ALL_TAGS: SeesTag = () => true;

function tagsVisibleWhere(userId: string, teamIds: string[]): Prisma.TagWhereInput {
  return { OR: [{ scope: "GLOBAL" }, { scope: "USER", ownerUserId: userId }, { scope: "TEAM", ownerTeamId: { in: teamIds } }] };
}

// The Prisma relations are named `contributors`/`versionTags` no matter
// how they're filtered; renamed here (`artists`, `tags`) so the
// (performer-only) list/create payload and the (all-roles) detail payload
// don't share a field name that means two different things, and so the
// join row (versionTags' own `id`, not useful to the client) doesn't leak
// into what's otherwise just a list of tags.
function toListItem({ contributors, versionTags, imageStorageKey, ...rest }: ListRow, seesTag: SeesTag = ALL_TAGS, sharedBy: SharedBy | null = null, privateIds?: ReadonlySet<string>): ListItem {
  return {
    ...rest,
    imageUrl: songImageUrl(rest.id, imageStorageKey),
    artists: contributors,
    tags: versionTags.map((vt) => vt.tag).filter(seesTag),
    sharedBy,
    ...(privateIds && { private: privateIds.has(rest.id) }),
  };
}

/** Someone who shared the song with the viewer (issue #77), and whether to edit. */
/** Who shared a song with the viewer; `team`, when it's shared with one of their teams (issue #331). */
type SharedBy = { id: string; displayName: string; canEdit: boolean; team?: { id: string; name: string }; organization?: { id: string; name: string } };

/** What the viewer may do with a song (see AccessPolicyService). */
interface Rights {
  /** Change its chart, details and credits: who can edit it, or someone it's shared with to edit. */
  canEdit: boolean;
  /** Everything else: delete, publish, share it, its links and files for everyone. */
  canManage: boolean;
  sharedBy: SharedBy | null;
}

type DetailRow = Prisma.SongVersionGetPayload<{ select: typeof DETAIL_SELECT }>;
type DetailItem = Omit<DetailRow, "versionTags" | "documentJson" | "imageStorageKey"> & {
  imageUrl: string | null;
  /** Always v2 (issue #60). */
  documentJson: SongDocumentV2;
  artists: DetailRow["contributors"];
  tags: DetailRow["versionTags"][number]["tag"][];
  /** Whether the current user may change its chart, details and credits (see SongVersionEditorGuard). */
  canEdit: boolean;
  /** Whether they may delete, publish or share it, or change its links (see SongVersionOwnerGuard). */
  canManage: boolean;
  sharedBy: SharedBy | null;
  /** Only the viewer can see it (issue #172), as in lists. */
  private?: boolean;
};

function toDetailItem(version: DetailRow, { canEdit, canManage, sharedBy }: Rights, seesTag: SeesTag = ALL_TAGS): DetailItem {
  const { versionTags, documentJson, imageStorageKey, ...rest } = version;
  return {
    ...rest,
    imageUrl: songImageUrl(rest.id, imageStorageKey),
    documentJson: readSongDocument(documentJson),
    artists: version.contributors.filter((c) => c.roles.includes("PERFORMER")),
    tags: versionTags.map((vt) => vt.tag).filter(seesTag),
    canEdit,
    canManage,
    sharedBy,
  };
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
    private readonly musicBrainz: MusicBrainzService,
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
   * Songs whose chords go like `text` ("1 5 6m 4", "I V vi IV", issue #204),
   * in whatever key: those the user can see, with the sections it's in. Most
   * sections first, then by title; at most 100.
   */
  async searchProgressions(user: AuthenticatedUser, text: string): Promise<{ query: string[] | null; songs: (ListItem & { sections: SectionProgression[] })[] }> {
    const query = parseProgressionQuery(text);
    if (!query) return { query: null, songs: [] };
    const visibleWhere = await this.access.songsVisibleTo(user);
    const visible = await this.prisma.client.songVersion.findMany({ where: visibleWhere, select: { id: true } });
    const ids = visible.map((row) => row.id);
    await this.refreshProgressions(ids);
    // The runs of 3 and 4 in the query must all be in a song's runs; shorter queries are checked one by one.
    const runs = new Set<string>();
    for (const size of [4, 3]) {
      if (query.length < size) continue;
      for (let i = 0; i + size <= query.length; i++) runs.add(query.slice(i, i + size).join("-"));
      break;
    }
    const rows = await this.prisma.client.songProgression.findMany({
      // The songs seen as a condition, not a list of their IDs: a big library is more than a query's 32,767 values.
      where: { songVersion: visibleWhere, ...(runs.size > 0 && { grams: { hasEvery: [...runs] } }) },
      select: { songVersionId: true, sections: true },
    });
    const found = rows
      .map((row) => ({ id: row.songVersionId, sections: findProgression(row.sections as unknown as SectionProgression[], query) }))
      .filter((match) => match.sections.length > 0);
    // The most sections first, then by title: the titles of a short query's many songs read in parts, under the 32,767 values a query takes.
    const titles = new Map<string, string>();
    for (let i = 0; i < found.length; i += 10_000) {
      const part = await this.prisma.client.songVersion.findMany({ where: { id: { in: found.slice(i, i + 10_000).map((match) => match.id) } }, select: { id: true, title: true } });
      for (const row of part) titles.set(row.id, row.title);
    }
    const best = found
      .filter((match) => titles.has(match.id))
      .sort((a, b) => b.sections.length - a.sections.length || titles.get(a.id)!.localeCompare(titles.get(b.id)!))
      .slice(0, 100);
    const versions = await this.prisma.client.songVersion.findMany({ where: { id: { in: best.map((match) => match.id) } }, select: LIST_SELECT });
    const byId = new Map(versions.map((version) => [version.id, version]));
    const seesTag = await this.seesTag(user);
    const [shared, privateIds] = await Promise.all([this.sharedByOf(user, versions.map((version) => version.id)), this.privateAmong(user, versions)]);
    const songs = best.filter((match) => byId.has(match.id)).map((match) => ({ ...toListItem(byId.get(match.id)!, seesTag, shared.get(match.id) ?? null, privateIds), sections: match.sections }));
    return { query, songs };
  }

  /**
   * A song's progressions, and the songs the user can see that move most
   * like it (issue #204): the runs of chords they share, each weighted by
   * how rare it is among those songs - 1-4-5 is everywhere, so sharing it
   * says little. At most 10, alike enough to be worth showing.
   */
  async progressionsOf(user: AuthenticatedUser, id: string) {
    await this.access.assertCanSeeSong(user, id);
    const visibleWhere = await this.access.songsVisibleTo(user);
    const visible = await this.prisma.client.songVersion.findMany({ where: visibleWhere, select: { id: true } });
    const ids = [...new Set([id, ...visible.map((row) => row.id)])];
    await this.refreshProgressions(ids);
    const rows = await this.prisma.client.songProgression.findMany({
      where: { OR: [{ songVersionId: id }, { songVersion: visibleWhere }] },
      select: { songVersionId: true, sections: true, grams: true },
    });
    const own = rows.find((row) => row.songVersionId === id);
    const sections = (own?.sections as unknown as SectionProgression[] | undefined) ?? [];
    if (!own || own.grams.length === 0) return { sections, similar: [] };
    // How many songs have each run: the rarer, the more it counts.
    const counts = new Map<string, number>();
    for (const row of rows) for (const gram of row.grams) counts.set(gram, (counts.get(gram) ?? 0) + 1);
    const weight = (gram: string) => Math.log(1 + rows.length / (counts.get(gram) ?? 1));
    const scored = rows
      .filter((row) => row.songVersionId !== id && row.grams.length > 0)
      .map((row) => ({
        id: row.songVersionId,
        score: progressionSimilarity(own.grams, row.grams, weight),
        shared: own.grams.filter((gram) => row.grams.includes(gram)),
      }))
      .filter((match) => match.score >= 0.12 && match.shared.length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    const versions = await this.prisma.client.songVersion.findMany({ where: { id: { in: scored.map((match) => match.id) } }, select: LIST_SELECT });
    const byId = new Map(versions.map((version) => [version.id, version]));
    const seesTag = await this.seesTag(user);
    const [shared, privateIds] = await Promise.all([this.sharedByOf(user, versions.map((version) => version.id)), this.privateAmong(user, versions)]);
    const similar = scored
      .filter((match) => byId.has(match.id))
      .map((match) => ({
        ...toListItem(byId.get(match.id)!, seesTag, shared.get(match.id) ?? null, privateIds),
        score: Math.round(match.score * 100) / 100,
        // The longest runs they share, the rarest first: what makes them alike.
        shared: match.shared.sort((a, b) => b.split("-").length - a.split("-").length || weight(b) - weight(a)).slice(0, 3),
      }));
    return { sections, similar };
  }

  /**
   * Works out again the progressions of those songs whose chart has moved on
   * since (or never had them): whichever way a chart was changed, the next
   * search sees it.
   */
  private async refreshProgressions(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const stale = await this.prisma.client.$queryRaw<{ id: string }[]>`
      SELECT sv.id FROM "SongVersion" sv
      LEFT JOIN "SongProgression" p ON p."songVersionId" = sv.id
      WHERE sv.id = ANY(${ids}::text[])
        AND (p."songVersionId" IS NULL OR p.revision <> COALESCE((sv."documentJson"->>'revision')::int, 0))`;
    for (let i = 0; i < stale.length; i += 200) {
      const batch = await this.prisma.client.songVersion.findMany({
        where: { id: { in: stale.slice(i, i + 200).map((row) => row.id) } },
        select: { id: true, documentJson: true },
      });
      for (const song of batch) {
        let revision = 0;
        let sections: SectionProgression[] = [];
        try {
          const doc = readSongDocument(song.documentJson);
          revision = doc.revision;
          sections = songProgressions(doc);
        } catch {
          // Not a chart it can read: no progressions.
        }
        const data = { revision, sections: sections as unknown as Prisma.InputJsonValue, grams: progressionGrams(sections) };
        await this.prisma.client.songProgression.upsert({ where: { songVersionId: song.id }, create: { songVersionId: song.id, ...data }, update: data });
      }
    }
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
  async statsForUser(user: AuthenticatedUser): Promise<{ songCount: number; artistCount: number }> {
    const where = await this.access.songsVisibleTo(user);
    const [songCount, artists] = await Promise.all([
      this.prisma.client.songVersion.count({ where }),
      // Grouped by the database (issue #341): Prisma's `distinct` read every credit and dropped the repeats itself.
      this.prisma.client.versionContributor.groupBy({
        by: ["source"],
        where: { roles: { has: "PERFORMER" }, source: { not: null }, songVersion: where },
      }),
    ]);
    return { songCount, artistCount: new Set(artists.map((a) => a.source!.trim().toLowerCase())).size };
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
  private async prepareUpdate(user: AuthenticatedUser, id: string, dto: UpdateSongVersionDto) {
    const existing = await this.prisma.client.songVersion.findUnique({
      where: { id },
      select: { documentJson: true },
    });
    if (!existing) throw new NotFoundException("Song version not found");
    if (dto.tagIds) await this.assertTagsUsable(user, dto.tagIds);

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
    user: AuthenticatedUser,
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
    if (dto.tagIds) {
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
   * as the song's image.
   */
  async linkMetadata(songVersionId: string, sources: Pick<MetadataSource, "provider" | "id">[]): Promise<MetadataMatch> {
    const match = await this.metadata.lookup(sources);
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
    if (match.artworkUrl && (await this.artwork.settings()).enabled) {
      await this.artwork.setFromUrl(songVersionId, match.artworkUrl).catch((err: Error) => this.logger.warn(`No artwork from the match for ${songVersionId}: ${err.message}`));
    }
    return match;
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
   * before there were other providers shows that recording, looked up
   * once and saved if it was linked before these summaries were kept.
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
    let match: MusicBrainzRecordingMatch;
    if (legacy.success && legacy.data.mbid === recording.value) match = legacy.data;
    else {
      match = await this.musicBrainz.getRecording(recording.value);
      await this.prisma.client.songVersionIdentifier.update({ where: { id: recording.id }, data: { details: match } });
    }
    return {
      title: match.title,
      artist: match.artist,
      album: match.releaseTitle,
      releaseDate: match.releaseDate,
      artworkUrl: null,
      thumbnailUrl: null,
      sources: [{ provider: "musicbrainz", id: match.mbid, url: match.sourceUrl }],
    };
  }
}

/** Carries a previewed update out of the transaction it rolls back. */
class Preview extends Error {
  constructor(readonly result: { before: SongSnapshot; after: SongSnapshot }) {
    super("preview");
  }
}
