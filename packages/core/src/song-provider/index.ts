import "../zod-config.js";
import { z } from "zod";

/**
 * The Song provider API (issue #157): what an outside server answers so
 * that Oneverse's built-in Song provider plugin can look songs up in it -
 * their details, their artwork, their artists' pictures, and their chords
 * and lyrics. Anyone can offer songs by running a server to this spec (a
 * publisher, a church's own library, a converter for another service).
 *
 * These schemas are the contract: the plugin reads every answer through
 * them, and the published description (docs/song-provider-api.json) is
 * written from them. Answers are read leniently - an unknown field is
 * ignored, so a server can add its own - and a field that doesn't fit is
 * a refused answer, never a guess.
 */
export const SONG_PROVIDER_API_VERSION = 1;

/** What a provider can be asked for: the plugin hooks it answers. */
export const SONG_PROVIDER_HOOKS = ["songInfo", "artwork", "artistPictures", "chords"] as const;
export type SongProviderHook = (typeof SONG_PROVIDER_HOOKS)[number];

const text = (max: number) => z.string().trim().min(1).max(max);
const url = z.string().max(2000).url();
/** Left out or null: not known. */
const maybe = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? null);

/** GET /v1/capabilities: who the provider is and what it answers. */
export const SongProviderCapabilitiesSchema = z.object({
  apiVersion: z.literal(SONG_PROVIDER_API_VERSION).describe("The version of this API it speaks: 1."),
  name: text(100).describe("Its name, shown in Oneverse unless the admin gives it another."),
  /** The hooks it answers; a hook it doesn't list is never asked. */
  provides: z.array(z.enum(SONG_PROVIDER_HOOKS)).max(SONG_PROVIDER_HOOKS.length).describe("What it answers: songInfo (search and songs/{id}), artwork (artworkUrl in its songs), artistPictures (artists/picture), chords (songs/{id}/content)."),
  /** Languages its songs are in (BCP 47, "en", "fr"), when it says. */
  languages: maybe(z.array(z.string().max(20)).max(100)).describe("The languages its songs are in, as BCP 47 tags (\"en\", \"fr\")."),
  /** Where people can read about it. */
  homepage: maybe(url),
});
export type SongProviderCapabilities = z.infer<typeof SongProviderCapabilitiesSchema>;

/** POST /v1/search's body. */
export const SongProviderSearchSchema = z.strictObject({
  title: text(300),
  artist: z.string().max(300).optional(),
  /** The language wanted, when the person said. */
  language: z.string().max(20).optional().describe("The language wanted, as a BCP 47 tag, when the person said."),
  /** At most this many songs (the provider may send fewer). */
  limit: z.number().int().min(1).max(50).describe("At most this many songs; it may send fewer."),
});
export type SongProviderSearch = z.infer<typeof SongProviderSearchSchema>;

/** How people rated a chart: out of 5, and by how many. */
export const SongProviderRatingSchema = z.object({
  value: z.number().min(0).max(5).describe("Out of 5."),
  count: maybe(z.number().int().min(0)).describe("How many people rated it; shown, and weighs the rating when versions are ordered."),
});
export type SongProviderRating = z.infer<typeof SongProviderRatingSchema>;

/**
 * One of a song's charts, when it has several (issue #369): another key, a
 * simpler or an acoustic one, from someone else or another site.
 */
export const SongProviderVersionSchema = z.object({
  id: text(200).describe("Its own ID for this version, sent as ?version= to /v1/songs/{id}/content."),
  name: maybe(z.string().trim().max(100)).describe("What sets it apart, as people call it: Original, Acoustic, Simplified."),
  key: maybe(z.string().max(10)).describe("Its key as a chord name: G, Bb, F#m."),
  capo: maybe(z.number().int().min(0).max(12)).describe("The fret the capo goes on, when the chart is played with one."),
  author: maybe(z.string().trim().max(100)).describe("Who wrote the chart down."),
  rating: maybe(SongProviderRatingSchema),
  source: maybe(
    z.object({
      name: text(100),
      url: maybe(url),
    }),
  ).describe("Where this version comes from, when the server gathers charts from other sites or people: shown as \"from <name>\"."),
  url: maybe(url).describe("This version's page, for people."),
});
export type SongProviderVersion = z.infer<typeof SongProviderVersionSchema>;

/** A song as listed in a search. */
export const SongProviderSongSummarySchema = z.object({
  /** The provider's own ID for it, used in /v1/songs/{id}. */
  id: text(200).describe("Its own ID for the song, used in /v1/songs/{id}."),
  title: text(300),
  artists: z.array(text(300)).max(20).default([]),
  album: maybe(z.string().max(300)),
  /** ISO date, possibly year-only ("1998") or year-month. */
  releaseDate: maybe(z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)).describe("When it came out: 2019, 2019-04 or 2019-04-12."),
  key: maybe(z.string().max(10)).describe("Its key as a chord name: G, Bb, F#m."),
  language: maybe(z.string().max(20)),
  thumbnailUrl: maybe(url).describe("A small picture to show among results."),
  /** Full size; downloaded by the server only from the provider's own address or a music service's image host. */
  artworkUrl: maybe(url).describe("Its artwork, full size, on this server's own address or a music service's image host."),
  /** The song's page on the provider's site, for people. */
  url: maybe(url).describe("The song's page on its site, for people."),
  /** Whether /v1/songs/{id}/content has its chords and lyrics. */
  hasContent: z.boolean().default(false).describe("Whether /v1/songs/{id}/content has its chords and lyrics."),
  /** Its charts, when it has several; none listed and hasContent: one chart, /content's. */
  versions: z
    .array(SongProviderVersionSchema)
    .max(50)
    .default([])
    .describe("Its charts, when it has several, each with its rating and where it comes from. Listed: the song has chords even without hasContent. None listed: one chart, if hasContent."),
});
export type SongProviderSongSummary = z.infer<typeof SongProviderSongSummarySchema>;

export const SongProviderSearchResultSchema = z.object({
  songs: z.array(SongProviderSongSummarySchema).max(50),
});
export type SongProviderSearchResult = z.infer<typeof SongProviderSearchResultSchema>;

/** GET /v1/songs/{id}: the song's details. */
export const SongProviderSongSchema = SongProviderSongSummarySchema.extend({
  /** Who wrote it. */
  writers: z.array(text(300)).max(30).default([]).describe("Who wrote it."),
  isrc: maybe(z.string().regex(/^[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}$/i)),
  ccli: maybe(z.string().regex(/^\d{1,10}$/)),
  /** Beats per minute. */
  tempo: maybe(z.number().positive().max(400)).describe("Beats per minute."),
  timeSignature: maybe(z.string().regex(/^\d{1,2}\/\d{1,2}$/)),
  durationSeconds: maybe(z.number().int().positive().max(24 * 3600)),
  copyright: maybe(z.string().max(500)),
  /** Where to listen: YouTube, Spotify, Apple Music or Deezer addresses. */
  links: z.array(url).max(10).default([]).describe("Where to listen: YouTube, Spotify, Apple Music or Deezer addresses."),
});
export type SongProviderSong = z.infer<typeof SongProviderSongSchema>;

/** GET /v1/songs/{id}/content: its chords and lyrics, as ChordPro text or a SongDocument v2. */
export const SongProviderContentSchema = z.discriminatedUnion("format", [
  z.object({
    format: z.literal("chordpro"),
    content: z.string().min(1).max(200_000).describe("The chart as ChordPro."),
    copyright: maybe(z.string().max(500)),
    /** What the provider lets people do with it, said to them as it is ("For use under a CCLI licence"). */
    rights: maybe(z.string().max(500)).describe("What people may do with it, shown to them as written."),
  }),
  z.object({
    format: z.literal("song-document/v2"),
    /** A SongDocument v2 (docs/song-document-v2.md), checked as a stored song's is. */
    content: z.record(z.string(), z.unknown()).describe("A SongDocument v2: docs/song-document-v2.md in Oneverse's repository."),
    copyright: maybe(z.string().max(500)),
    rights: maybe(z.string().max(500)),
  }),
]);
export type SongProviderContent = z.infer<typeof SongProviderContentSchema>;

/** GET /v1/artists/picture?name=…: an artist's picture. */
export const SongProviderArtistPictureSchema = z.object({
  url,
  /** The artist's page, credited under the picture. */
  pageUrl: maybe(url).describe("The artist's page, credited under the picture."),
});
export type SongProviderArtistPicture = z.infer<typeof SongProviderArtistPictureSchema>;

/** An error answer: `{ "error": { "code": "not-found", "message": "…" } }` with a 4xx or 5xx status. */
export const SongProviderErrorSchema = z.object({
  error: z.object({
    code: z.enum(["unauthorized", "not-found", "throttled", "invalid", "error"]),
    message: z.string().max(500),
  }),
});

/**
 * A metadata source's ID for a song from a Song provider: the provider's
 * row in Oneverse, then its own ID for the song ("<providerId>:<songId>").
 */
export function songProviderSourceId(providerId: string, songId: string): string {
  return `${providerId}:${songId}`;
}

export function readSongProviderSourceId(id: string): { providerId: string; songId: string } | null {
  const at = id.indexOf(":");
  if (at <= 0 || at === id.length - 1) return null;
  return { providerId: id.slice(0, at), songId: id.slice(at + 1) };
}
