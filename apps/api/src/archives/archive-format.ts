import { z } from "zod";

/**
 * What's in an archive (issue #351): one zip with `manifest.json` first, the
 * content as JSON, each song as ChordPro too (for people, never read back),
 * and the stored files as `files/<sha256>`. Format 1.
 *
 * An archive comes back from anyone, so everything read from one is checked
 * here: an import trusts nothing in it - not its IDs, not its owners, not
 * the people it names - and only stores a file whose bytes it was given.
 */
export const ARCHIVE_FORMAT = "oneverse-archive";
export const ARCHIVE_FORMAT_VERSION = 1;

export const ARCHIVE_FILES = {
  manifest: "manifest.json",
  songs: "songs.json",
  arrangements: "arrangements.json",
  songbooks: "songbooks.json",
  sets: "sets.json",
  notes: "notes.json",
} as const;

/** Where a stored file is in the archive. */
export const archiveFilePath = (sha256: string) => `files/${sha256}`;
const SHA256 = /^[0-9a-f]{64}$/;

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().max(max);
const optionalText = (max: number) => z.string().max(max).nullish();
const optionalInt = z.number().int().nullish();
const date = z.string().max(40).nullish();
/** Free-form JSON the importer checks itself (a chart, a note's anchor). */
const json = z.unknown();

const VISIBILITY = ["PRIVATE", "TEAM", "SONG", "SHARED"] as const;

/** A team the archive's content belongs to (a team's or an organisation's archive). */
export const ArchiveTeamSchema = z.object({ id, name: text(200) });

export const ArchiveManifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  version: z.number().int().min(1),
  createdAt: z.string().max(40),
  server: z.object({ version: text(60).nullish() }).optional(),
  scope: z.object({ kind: z.enum(["USER", "TEAM", "ORGANIZATION"]), id, name: text(200) }),
  teams: z.array(ArchiveTeamSchema).max(1000).default([]),
  counts: z.record(z.string(), z.number().int()).default({}),
});
export type ArchiveManifest = z.infer<typeof ArchiveManifestSchema>;

const ArchiveCreditSchema = z.object({
  source: optionalText(300),
  roles: z.array(z.enum(["AUTHOR", "COMPOSER", "LYRICIST", "TRANSLATOR", "ADAPTOR", "ARRANGER", "PERFORMER"])).max(7),
});

const ArchiveTagSchema = z.object({ slug: text(200), label: text(200) });

const ArchiveIdentifierSchema = z.object({
  type: text(40),
  value: text(500),
  sourceUrl: optionalText(2000),
  note: optionalText(2000),
  details: json.optional(),
});

const ArchiveLinkSchema = z.object({
  id,
  url: text(2000),
  service: z.enum(["YOUTUBE", "SPOTIFY", "APPLE_MUSIC", "DEEZER", "OTHER"]),
  value: optionalText(500),
  label: text(300),
  startSeconds: optionalInt,
  visibility: z.enum(VISIBILITY),
  visibleToTeamId: id.nullish(),
});

const ArchiveAttachmentSchema = z.object({
  id,
  type: z.enum(["PDF", "CHORDPRO", "MUSICXML", "ABC_NOTATION", "TEXT", "IMAGE", "AUDIO", "OTHER"]),
  filename: text(500),
  mimeType: text(200),
  sha256: z.string().regex(SHA256),
  sizeBytes: z.number().int().min(0),
  originalSha256: z.string().regex(SHA256).nullish(),
  originalMimeType: optionalText(200),
  originalSizeBytes: optionalInt,
  stemPart: z.enum(["VOCALS", "HARMONY_SOPRANO", "HARMONY_ALTO", "HARMONY_TENOR", "HARMONY_BASS", "BACKING_VOCALS", "DRUMS", "BASS", "GUITAR", "KEYS", "OTHER", "CLICK"]).nullish(),
  pitchOffset: optionalInt,
  cuePoints: json.optional(),
  locked: z.boolean().default(false),
  origin: z.enum(["UPLOADED", "SEPARATED", "RECORDED"]).default("UPLOADED"),
  detected: z.array(text(100)).max(50).default([]),
  partName: optionalText(200),
  recordingKey: optionalText(40),
  recordingTempo: z.number().nullish(),
  recordingFirstBeat: z.number().nullish(),
  recordingFreeIntro: z.boolean().default(false),
  recordingBeats: z.array(z.number()).max(100_000).default([]),
  recordingDownbeats: z.array(z.number()).max(100_000).default([]),
  recordingTimeSignature: optionalText(20),
  multitrackId: optionalText(64),
  multitrackName: optionalText(300),
  multitrackSetId: id.nullish(),
  otherTake: z.boolean().default(false),
  visibility: z.enum(VISIBILITY),
  visibleToTeamId: id.nullish(),
});
export type ArchiveAttachment = z.infer<typeof ArchiveAttachmentSchema>;

export const ArchiveSongSchema = z.object({
  id,
  /** The team that owns it; left out, the person whose archive it is. */
  teamId: id.nullish(),
  title: text(500),
  alternateTitle: optionalText(500),
  versionName: optionalText(500),
  sortTitle: optionalText(500),
  language: text(35),
  trustLabel: optionalText(300),
  imageSha256: z.string().regex(SHA256).nullish(),
  imageSourceUrl: optionalText(2000),
  copyright: optionalText(2000),
  copyrightYear: optionalInt,
  publisher: optionalText(500),
  album: optionalText(500),
  year: optionalInt,
  isrc: optionalText(40),
  reference: optionalText(500),
  notes: optionalText(20_000),
  ccli: optionalText(40),
  capo: optionalInt,
  documentJson: json,
  relationshipType: z.enum(["ORIGINAL", "DIRECT_TRANSLATION", "SINGABLE_ADAPTATION", "LYRICAL_ADAPTATION", "ALTERNATE_VERSION", "SIMPLIFIED_VERSION", "LIVE_VERSION", "UNKNOWN_ORIGIN"]).nullish(),
  parentId: id.nullish(),
  defaultGrooveStyleId: optionalText(64),
  defaultGrooveVariant: optionalText(64),
  credits: z.array(ArchiveCreditSchema).max(200).default([]),
  tags: z.array(ArchiveTagSchema).max(200).default([]),
  identifiers: z.array(ArchiveIdentifierSchema).max(50).default([]),
  links: z.array(ArchiveLinkSchema).max(500).default([]),
  attachments: z.array(ArchiveAttachmentSchema).max(2000).default([]),
  createdAt: date,
});
export type ArchiveSong = z.infer<typeof ArchiveSongSchema>;

/** A song an archive points at without holding it (the catalogue's, or someone else's shared one): kept only if the importer can see it. */
const SongRefSchema = z.object({ songId: id, songTitle: optionalText(500) });

export const ArchiveArrangementSchema = SongRefSchema.extend({
  id,
  teamId: id.nullish(),
  name: text(300),
  description: optionalText(5000),
  documentJson: json,
  isTeamDefault: z.boolean().default(false),
  /** A set's own arrangement (one of the set's items'); kept with the set. */
  setItemId: id.nullish(),
  linkId: id.nullish(),
  multitrackId: optionalText(64),
  guitarTuningSlug: optionalText(100),
});
export type ArchiveArrangement = z.infer<typeof ArchiveArrangementSchema>;

export const ArchiveSongbookSchema = z.object({
  id,
  teamId: id.nullish(),
  name: text(300),
  abbreviation: optionalText(40),
  language: optionalText(35),
  publisher: optionalText(500),
  year: optionalInt,
  kind: z.enum(["SIMPLE", "NUMBERED"]).default("NUMBERED"),
  color: optionalText(40),
  avatarSha256: z.string().regex(SHA256).nullish(),
  sections: json.optional(),
  entries: z.array(SongRefSchema.extend({ entryCode: optionalText(40) })).max(20_000).default([]),
});
export type ArchiveSongbook = z.infer<typeof ArchiveSongbookSchema>;

const ArchiveSetItemSchema = z.object({
  id,
  kind: z.enum(["SONG", "TEXT", "PASSAGE"]),
  songId: id.nullish(),
  songTitle: optionalText(500),
  text: json.optional(),
  passage: json.optional(),
  arrangementId: id.nullish(),
  position: z.number().int().min(0),
  transposeSteps: z.number().int().min(-11).max(11).default(0),
  tempoOverride: optionalInt,
  notes: optionalText(500),
  transition: z.enum(["STOP", "NEXT", "SEGUE", "TRANSITION"]).nullish(),
  transitionNote: optionalText(200),
  transitionChords: z.array(text(20)).max(8).default([]),
  timer: json.optional(),
  screenTemplate: json.optional(),
});

export const ArchiveSetSchema = z.object({
  id,
  teamId: id.nullish(),
  name: optionalText(300),
  description: optionalText(5000),
  eventDate: date,
  items: z.array(ArchiveSetItemSchema).max(500).default([]),
});
export type ArchiveSet = z.infer<typeof ArchiveSetSchema>;

const ArchiveReplySchema = z.object({ authorName: optionalText(200), content: text(20_000), createdAt: date });

export const ArchiveNoteSchema = SongRefSchema.extend({
  id,
  place: z.enum(["ME", "TEAM", "SONGBOOK", "SET", "SONG"]),
  content: text(20_000),
  anchor: json,
  authorName: optionalText(200),
  /** Whether the person whose archive it is wrote it. */
  mine: z.boolean().default(false),
  teamId: id.nullish(),
  songbookId: id.nullish(),
  setId: id.nullish(),
  resolvedAt: date,
  createdAt: date,
  replies: z.array(ArchiveReplySchema).max(500).default([]),
});
export type ArchiveNote = z.infer<typeof ArchiveNoteSchema>;

export const ArchiveContentSchemas = {
  songs: z.array(ArchiveSongSchema).max(100_000),
  arrangements: z.array(ArchiveArrangementSchema).max(200_000),
  songbooks: z.array(ArchiveSongbookSchema).max(10_000),
  sets: z.array(ArchiveSetSchema).max(50_000),
  notes: z.array(ArchiveNoteSchema).max(200_000),
};

export interface ArchiveContent {
  manifest: ArchiveManifest;
  songs: ArchiveSong[];
  arrangements: ArchiveArrangement[];
  songbooks: ArchiveSongbook[];
  sets: ArchiveSet[];
  notes: ArchiveNote[];
}

/** What an import did, for the person who brought it in. */
export interface ArchiveImportSummary {
  created: Record<"songs" | "arrangements" | "songbooks" | "sets" | "notes" | "files" | "teams", number>;
  /** Already there, the same: used as it is, never changed. */
  kept: Record<"songs" | "arrangements" | "songbooks" | "sets", number>;
  /** What couldn't come in, and why (the first 100). */
  leftOut: string[];
  leftOutCount: number;
}

export function isSha256(value: string): boolean {
  return SHA256.test(value);
}
