import "../zod-config.js";
import { z } from "zod";
import { ENTITY_COLORS, SONGBOOK_KINDS } from "../constants/index.js";
import { ISO_639_1_CODES } from "../languages/index.js";
import type { SongbookSection } from "../songbook-sections/index.js";
import { optional, queryBoolean, webAddress } from "./fields.js";

// Checked by validateSongbookSections where they're saved (its own messages).
const sections = z.array(z.unknown()).transform((value) => value as SongbookSection[]);
const language = optional(z.enum(ISO_639_1_CODES)).describe("ISO 639-1 language code");

export const CreateSongbookSchema = z.strictObject({
  name: z.string().min(1).max(200),
  kind: z.enum(SONGBOOK_KINDS).describe("SIMPLE = unordered collection; NUMBERED = entries require a unique per-songbook number"),
  abbreviation: optional(z.string().max(30)),
  language,
  publisher: optional(z.string().max(300)),
  year: optional(z.number().int()),
  teamId: optional(z.string()).describe("Team to own this songbook under (must be a member). Omit for USER scope, or set global instead."),
  global: optional(z.boolean()).describe("Create as a GLOBAL, admin-curated songbook visible to everyone. Global admins only."),
});
export type CreateSongbookRequest = z.input<typeof CreateSongbookSchema>;

export const UpdateSongbookSchema = z.strictObject({
  name: optional(z.string().min(1).max(200)),
  abbreviation: optional(z.string().max(30)),
  language,
  publisher: optional(z.string().max(300)),
  year: optional(z.number().int()),
  sections: optional(sections).describe("NUMBERED songbooks only - ordered list of {label, start, end} number ranges"),
  color: z.enum(ENTITY_COLORS).nullable().optional().describe("Its colour (issue #161); null: one derived from its name"),
});
export type UpdateSongbookRequest = z.input<typeof UpdateSongbookSchema>;

export const AddSongbookEntrySchema = z.strictObject({
  songVersionId: z.string(),
  entryCode: optional(z.string().min(1).max(30)).describe(
    'The number/code this song has in the book, e.g. "245", "A-17". Required for NUMBERED songbooks, ignored for SIMPLE ones.',
  ),
  teamAccess: optional(z.enum(["share", "move"])).describe(
    "One of your own personal songs in a team's songbook (issue #340): share it with the songbook's team to view, or move it to the team, then add it. Without it, such a song is refused with code SONG_NOT_SHARED",
  ),
});

export const ImportSongbookFromCatalogSchema = z.strictObject({
  catalogId: z.string().describe("The SongbookCatalog to import from"),
  teamId: optional(z.string()).describe("Team to own the new songbook under (must be a member). Omit for USER scope, or set global instead."),
  global: optional(z.boolean()).describe("Create as a GLOBAL, admin-curated songbook visible to everyone. Global admins only."),
});

const catalogFields = {
  abbreviation: optional(z.string().max(30)),
  publisher: optional(z.string().max(300)),
  isbn: optional(z.string().max(30)),
  description: optional(z.string().max(2000)),
  coverImageUrl: optional(webAddress()),
  officialUrl: optional(webAddress()),
  language,
};

export const CreateCatalogSchema = z.strictObject({
  name: z.string().min(1).max(200),
  ...catalogFields,
  licensed: optional(z.boolean()).describe("Defaults to false"),
});

export const UpdateCatalogSchema = z.strictObject({
  name: optional(z.string().min(1).max(200)),
  ...catalogFields,
  licensed: optional(z.boolean()),
  sections: optional(sections).describe(
    'The printed volumes: an ordered list of {label, start, end} number ranges ("JEM1": 1-371...). Copied into songbooks imported from the catalogue.',
  ),
});

/**
 * An entry's fields, any subset. Values are checked by the shared catalogue
 * rules (validateCatalogEntryPatch), the same ones file imports use - not
 * here. null (or "") clears a field; a field left out is left alone.
 */
export const CatalogEntryInputSchema = z.strictObject({
  entryCode: z.unknown().optional().describe("The song's number in the book"),
  title: z.unknown().optional(),
  sortTitle: z.unknown().optional(),
  subtitle: z.unknown().optional(),
  originalSong: z.unknown().optional().describe('Another entry, e.g. "JEM 245"'),
  originalLanguage: z.unknown().optional(),
  artist: z.unknown().optional(),
  composer: z.unknown().optional(),
  lyricist: z.unknown().optional(),
  album: z.unknown().optional(),
  year: z.unknown().optional(),
  key: z.unknown().optional(),
  timeSignature: z.unknown().optional(),
  tempo: z.unknown().optional(),
  durationSeconds: z.unknown().optional(),
  copyright: z.unknown().optional(),
  ccli: z.unknown().optional(),
  isrc: z.unknown().optional(),
  reference: z.unknown().optional(),
  tags: z.unknown().optional(),
  links: z.unknown().optional().describe("YouTube, Spotify, Apple Music or Deezer addresses"),
  notes: z.unknown().optional(),
});

const MAX_CATALOG_FILE_CHARS = 10 * 1024 * 1024;

/** A catalogue file (docs/songbook-catalog-format.md), sent as text. */
export const CatalogFileSchema = z.strictObject({
  content: z.string().max(MAX_CATALOG_FILE_CHARS).describe("The file's text, CSV or JSON"),
  filename: optional(z.string().max(255)).describe("Used to tell CSV from JSON; otherwise guessed from the content"),
});

export const ImportCatalogEntriesSchema = CatalogFileSchema.extend({
  mode: optional(z.enum(["merge", "replace"])).describe("merge (default) adds and updates; replace also removes entries not in the file"),
  dryRun: optional(z.boolean()).describe("Only report what would change"),
});

/** GET /songbook-entries: entries by the number people call out (issues #48, #213). */
export const SongbookEntrySearchQuerySchema = z.strictObject({
  q: z.string().max(60).describe('A songbook reference: "HY 42", "HY42", "Hymns 42", "42", "A-17"'),
  more: optional(queryBoolean()).describe("More of each group (Show more): numbers starting with it, and containing it"),
  addableTo: optional(z.string().max(100)).describe("Only songs that can go in this set, which you can change (issue #328: its Add songs); in a team's set, your own personal songs too, shared with the team as they're added (issue #331)"),
});
export type SongbookEntrySearchQuery = z.input<typeof SongbookEntrySearchQuerySchema>;

const SONG_INFO_FIELD_NAMES = ["title", "artists", "writers", "album", "year", "isrc", "tempo", "duration", "artwork"] as const;

/** A songbook's songs looked up again at the providers (issue #353): all of them, or those listed. */
export const StartSongInfoRefreshSchema = z.strictObject({
  songVersionIds: optional(z.array(z.string().min(1)).min(1).max(2000)).describe("Only these of its songs; left out, every song in it"),
});
export type StartSongInfoRefreshRequest = z.input<typeof StartSongInfoRefreshSchema>;

/** What to use of a refresh (issue #353): per song, the fields ticked in its review. */
export const ApplySongInfoRefreshSchema = z.strictObject({
  songs: z
    .array(z.strictObject({ songVersionId: z.string().min(1), fields: z.array(z.enum(SONG_INFO_FIELD_NAMES)).max(SONG_INFO_FIELD_NAMES.length) }))
    .min(1)
    .max(2000),
});
export type ApplySongInfoRefreshRequest = z.input<typeof ApplySongInfoRefreshSchema>;
