import "../zod-config.js";
import { z } from "zod";
import { ISO_639_1_CODES } from "../languages/index.js";
import { SONG_DOCUMENT_LIMITS } from "../schemas/song-document-v2.js";
import { SUPPORTED_IMPORT_FORMATS } from "../constants/index.js";
import { clearableInt, clearableText, nameList, optional, queryBoolean, queryInt, queryText, requiredText } from "./fields.js";

const credits = (who: string) => nameList({ max: 20, each: 300 }).optional().describe(`Replaces the song's ${who}`);
const artists = nameList({ min: 1, max: 20, each: 300, minMessage: "A song needs at least one artist" });

/** An ISRC: dashes and spaces dropped, upper case; "" or null clears it. */
const isrc = z
  .string()
  .overwrite((value) => value.replace(/[\s-]/g, "").toUpperCase())
  .transform((value) => value || null)
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/, "ISRC must be 12 characters like USRC17607839")
      .nullable(),
  )
  .nullable()
  .optional()
  .describe("Recording code; dashes and spaces are dropped");

/**
 * A song's optional fields, shared by create and (partial) update. Left
 * out, a field is left alone; null (or "") clears it. The name lists and
 * tagIds replace what the song has; content replaces its chart.
 */
export const songFields = {
  alternateTitle: clearableText(300).describe('Shown as "Subtitle"'),
  versionName: clearableText(100).describe('Tells this version apart from the song\'s others, e.g. "Acoustic"'),
  sortTitle: clearableText(300).describe("How to sort it, if not by title"),
  album: clearableText(300),
  year: clearableInt(1000, 2999).describe("Year written or published"),
  copyright: clearableText(500),
  copyrightYear: clearableInt(1000, 2999),
  publisher: clearableText(300),
  ccli: clearableText(50),
  isrc,
  reference: clearableText(300).describe("e.g. the scripture a song draws on"),
  notes: z
    .string()
    .overwrite((value) => value.replace(/\r\n?/g, "\n"))
    .trim()
    .max(5000)
    .transform((value) => value || null)
    .nullable()
    .optional(),
  key: clearableText(20).describe("Free-text key, e.g. G, Bb, C#m"),
  tempo: clearableInt(20, 400).describe("Tempo in BPM"),
  timeSignature: z
    .string()
    .trim()
    .transform((value) => value || null)
    .pipe(
      z
        .string()
        .regex(/^\d{1,2}\/\d{1,2}$/, "timeSignature must be like 4/4 or 6/8")
        .nullable(),
    )
    .nullable()
    .optional(),
  durationSeconds: clearableInt(1, 36000).describe("Running time in seconds"),
  capo: clearableInt(0, 11).describe("Capo fret for the chords as written; 0 or null for none"),
  composers: credits("composers"),
  lyricists: credits("lyricists"),
  writers: credits("writers (words and music)"),
  arrangers: credits("arrangers"),
  translators: credits("translators"),
  adaptors: credits("adaptors"),
  tagIds: optional(z.array(z.string()).max(100)).describe("Replaces the song's tags (ids of tags you can see)"),
  content: optional(z.string().max(200_000)).describe("Chart text to replace the song's content with"),
  contentFormat: optional(z.enum(SUPPORTED_IMPORT_FORMATS)).describe("content's format; guessed when left out"),
  sections: optional(z.array(z.unknown()).max(SONG_DOCUMENT_LIMITS.sections)).describe(
    "The chart as SongDocument v2 sections (docs/song-document-v2.md), IDs and all - what the structured editor saves. Instead of content, not with it.",
  ),
  flow: optional(z.array(z.unknown()).max(SONG_DOCUMENT_LIMITS.flowItems)).describe(
    "The order the song is sung in (SongDocument v2 `flow`: repeats, a pass's label, key change and note). Left out, it follows the sections.",
  ),
};

/** The shared fields as the API has them once parsed. */
export type SongFields = z.output<z.ZodObject<typeof songFields>>;

/** POST /song-versions */
export const CreateSongVersionSchema = z.strictObject({
  ...songFields,
  workId: optional(z.string()).describe(
    "Existing Work to add this version to. Omit to create a new Work (this becomes its preferred original version).",
  ),
  basedOnVersionId: optional(z.string()).describe(
    "A song you can see that this is another version of (an acoustic arrangement, say): it joins that song's Work.",
  ),
  teamId: optional(z.string()).describe("Team to own this version under (must be a member). Omit to own it personally."),
  title: requiredText(300),
  artists: artists.describe("Who performs it: at least one artist (band or person)"),
  language: z.enum(ISO_639_1_CODES).describe("ISO 639-1 language code"),
});
export type CreateSongVersionRequest = z.input<typeof CreateSongVersionSchema>;

/**
 * PATCH /song-versions/:id - a field left out is left alone; null (or "")
 * clears it. Title, language and artists can't be cleared.
 */
export const UpdateSongVersionSchema = z.strictObject({
  ...songFields,
  title: optional(requiredText(300)),
  artists: optional(artists).describe("Replaces the song's artists; at least one"),
  language: optional(z.enum(ISO_639_1_CODES)).describe("ISO 639-1 language code"),
  revision: optional(z.number().int().min(0)).describe(
    "The document revision the edit started from; a save is refused (409) if the song was saved since",
  ),
});
export type UpdateSongVersionRequest = z.input<typeof UpdateSongVersionSchema>;

export const SONG_SORTS = ["title", "updatedAt", "createdAt", "language", "publicationState"] as const;
export type SongSort = (typeof SONG_SORTS)[number];

/** GET /song-versions: one page of the songs you can see, optionally searched and filtered. */
export const ListSongVersionsQuerySchema = z.strictObject({
  q: optional(queryText(200)).describe("Matches title, subtitle, version name, artist, or an exact CCLI number (ignoring case)"),
  language: optional(z.string().max(10)).describe("ISO 639-1 language code"),
  tagId: optional(z.string()).describe("Only songs with this tag"),
  favorites: optional(queryBoolean()).describe("Only your favorites (issue #81)"),
  artist: optional(queryText(200)).describe("Only songs by this artist (the whole name, ignoring case and accents)"),
  sort: optional(z.enum(SONG_SORTS)).describe("Defaults to updatedAt"),
  dir: optional(z.enum(["asc", "desc"])).describe("Defaults to desc for dates, asc otherwise"),
  page: optional(queryInt().pipe(z.number().min(1))).describe("Defaults to 1"),
  pageSize: optional(queryInt().pipe(z.number().min(1).max(200))).describe("Defaults to 50"),
  references: optional(queryBoolean()).describe("Each song's places in your numbered songbooks too (issue #213): songbookReferences"),
  in: optional(z.enum(["lyrics"])).describe("lyrics: q searches the songs' words instead (issue #221), each song with the line found (lyricsMatch); at least three letters"),
});

export const SetStreamingLinkSchema = z.strictObject({
  // A bare Spotify/YouTube ID isn't a URL, so the URL shape is only checked
  // when the value looks like one (contains "://").
  url: z
    .string()
    .min(1)
    .refine((value) => !value.includes("://") || URL.canParse(value), { params: { format: "url" } })
    .describe("A share link (or, for Spotify/YouTube, a bare ID also works)"),
});

/** GET /progressions/search: songs by chord progression (issue #204), "1 5 6m 4" or "I V vi IV". */
export const ProgressionSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(120),
});
export type ProgressionSearchQuery = z.input<typeof ProgressionSearchQuerySchema>;

/** POST /song-versions/:id/repeats (issue #231): these repeats linked, or all of them, on the song as it was at `revision`. */
export const LinkRepeatsSchema = z.strictObject({
  revision: z.number().int().nonnegative().describe("The song's revision the repeats were found in: refused if it was saved since"),
  sectionIds: optional(z.array(z.string().trim().min(1).max(64)).min(1).max(SONG_DOCUMENT_LIMITS.sections)).describe("The repeats to link; left out, all of them"),
});
export type LinkRepeatsRequest = z.input<typeof LinkRepeatsSchema>;

/** POST /admin/repeats/backfill (issue #231): the library's repeats counted, or with `apply`, the same and transposed ones linked. */
export const RepeatsBackfillSchema = z.strictObject({
  apply: optional(z.boolean()).describe("Link the repeats that are the same or transposed; left out, only count them"),
});
export type RepeatsBackfillRequest = z.input<typeof RepeatsBackfillSchema>;
