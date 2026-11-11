/**
 * What a song is read as and answered as (issue #427, out of
 * `song-versions.service.ts`): what a list and a song's page select, and the
 * rows turned into what the API answers.
 */

import { readSongDocument, type LyricsMatch, type MetadataSource, type SongDocumentV2 } from "@oneverse/core";
import type { ContributorRole, Prisma } from "@oneverse/db";
import { songImageUrl } from "../artwork/song-image-url.js";

export const LIST_SELECT = {
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
export const STREAMING_TYPE_OF: Partial<Record<MetadataSource["provider"], (typeof STREAMING_IDENTIFIER_TYPES)[number]>> = { apple_music: "APPLE_MUSIC", deezer: "DEEZER", spotify: "SPOTIFY" };

export interface SongVersionOwner {
  ownerScope: "GLOBAL" | "TEAM" | "USER";
  ownerUserId: string | null;
  ownerTeamId: string | null;
}

export const DETAIL_SELECT = {
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

export type ListRow = Prisma.SongVersionGetPayload<{ select: typeof LIST_SELECT }>;
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
export type SeesTag = (tag: Pick<TagRow, "scope" | "ownerUserId" | "ownerTeamId">) => boolean;
const ALL_TAGS: SeesTag = () => true;

export function tagsVisibleWhere(userId: string, teamIds: string[]): Prisma.TagWhereInput {
  return { OR: [{ scope: "GLOBAL" }, { scope: "USER", ownerUserId: userId }, { scope: "TEAM", ownerTeamId: { in: teamIds } }] };
}

// The Prisma relations are named `contributors`/`versionTags` no matter
// how they're filtered; renamed here (`artists`, `tags`) so the
// (performer-only) list/create payload and the (all-roles) detail payload
// don't share a field name that means two different things, and so the
// join row (versionTags' own `id`, not useful to the client) doesn't leak
// into what's otherwise just a list of tags.
export function toListItem({ contributors, versionTags, imageStorageKey, ...rest }: ListRow, seesTag: SeesTag = ALL_TAGS, sharedBy: SharedBy | null = null, privateIds?: ReadonlySet<string>): ListItem {
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
export type SharedBy = { id: string; displayName: string; canEdit: boolean; team?: { id: string; name: string }; organization?: { id: string; name: string } };

/** What the viewer may do with a song (see AccessPolicyService). */
export interface Rights {
  /** Change its chart, details and credits: who can edit it, or someone it's shared with to edit. */
  canEdit: boolean;
  /** Everything else: delete, publish, share it, its links and files for everyone. */
  canManage: boolean;
  sharedBy: SharedBy | null;
}

type DetailRow = Prisma.SongVersionGetPayload<{ select: typeof DETAIL_SELECT }>;
export type DetailItem = Omit<DetailRow, "versionTags" | "documentJson" | "imageStorageKey"> & {
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

export function toDetailItem(version: DetailRow, { canEdit, canManage, sharedBy }: Rights, seesTag: SeesTag = ALL_TAGS): DetailItem {
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
