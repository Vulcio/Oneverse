import "../zod-config.js";
import { z } from "zod";

/**
 * Metadata providers (issue #22): where Auto detect looks a song up. Each
 * answers in the same shape; the same release found by several is one
 * match, listing them all as its sources.
 */
export const METADATA_PROVIDERS = ["musicbrainz", "apple_music", "deezer", "spotify"] as const;
export type MetadataProviderKey = (typeof METADATA_PROVIDERS)[number];

export const METADATA_PROVIDER_NAMES: Record<MetadataProviderKey, string> = {
  musicbrainz: "MusicBrainz",
  apple_music: "Apple Music",
  deezer: "Deezer",
  spotify: "Spotify",
};

/**
 * What a provider can be asked for (issue #89): song info (Auto detect),
 * album artwork (a song's image), artist pictures and artist bios. The
 * admin chooses, per provider, which of what it can do it's asked for.
 */
export const METADATA_CAPABILITIES = ["songInfo", "artwork", "artistPictures", "artistBios"] as const;
export type MetadataCapability = (typeof METADATA_CAPABILITIES)[number];

/** What each provider can do: MusicBrainz's bios are Wikipedia's, found through its Wikidata links. */
export const PROVIDER_CAPABILITIES: Record<MetadataProviderKey, readonly MetadataCapability[]> = {
  musicbrainz: ["songInfo", "artistBios"],
  apple_music: ["songInfo", "artwork", "artistPictures"],
  deezer: ["songInfo", "artwork", "artistPictures"],
  spotify: ["songInfo", "artwork", "artistPictures"],
};

export const MetadataSourceSchema = z.object({
  provider: z.enum(METADATA_PROVIDERS),
  /** The provider's own ID: a MusicBrainz recording MBID, an Apple Music or Deezer track ID. */
  id: z.string().min(1).max(100),
  url: z.string().url(),
});
export type MetadataSource = z.infer<typeof MetadataSourceSchema>;

export const MetadataMatchSchema = z.object({
  title: z.string(),
  artist: z.string().nullable(),
  /** The album or single it came out on. */
  album: z.string().nullable(),
  /** ISO date, possibly year-only ("1998") or year-month. */
  releaseDate: z.string().nullable(),
  /** The release's artwork, full size (Apple Music or Deezer). */
  artworkUrl: z.string().url().nullable(),
  /** A small one, to show among the results. */
  thumbnailUrl: z.string().url().nullable(),
  /** The recording's ISRC, where the provider has it (the Apple Music API, issue #87). */
  isrc: z.string().nullable().optional(),
  /** Who wrote it, where the provider says (the Apple Music API's composers, issue #87). */
  composers: z.array(z.string()).optional(),
  /** Its tempo in BPM, where the provider says (Deezer's track, issue #352). */
  tempo: z.number().positive().nullable().optional(),
  /** How long the recording is, in whole seconds (issue #352). */
  durationSeconds: z.number().int().positive().nullable().optional(),
  sources: z.array(MetadataSourceSchema).min(1),
});
export type MetadataMatch = z.infer<typeof MetadataMatchSchema>;

/** A match chosen in Auto detect (issue #22): its sources, looked up again. The request POST /song-versions/:id/metadata takes. */
const chosenSources = z.array(z.strictObject(MetadataSourceSchema.pick({ provider: true, id: true }).shape)).min(1).max(METADATA_PROVIDERS.length);

export const LinkMetadataSchema = z.strictObject({
  sources: chosenSources,
  /** Whether the match's artwork becomes the song's image (issue #352): left out, it does; false keeps the song's own. */
  artwork: z.boolean().optional(),
});
export type LinkMetadata = z.infer<typeof LinkMetadataSchema>;

/** A match looked up again from its sources, to review before it's used (issue #352): what POST /metadata/lookup takes. */
export const MetadataLookupSchema = z.strictObject({ sources: chosenSources });
export type MetadataLookup = z.infer<typeof MetadataLookupSchema>;
