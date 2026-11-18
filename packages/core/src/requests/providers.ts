import "../zod-config.js";
import { z } from "zod";
import { nameList, optional } from "./fields.js";

/** Metadata providers (issue #22): Auto detect's search. */
export const MetadataSearchQuerySchema = z.strictObject({
  title: z.string().min(1).max(300),
  artist: optional(z.string().max(300)),
});

const providerSetting = z.strictObject({
  key: z.string().max(40),
  /** What it's asked for (issue #89); left out, on. `enabled` is song info, as issue #22's lists said. */
  songInfo: optional(z.boolean()),
  artwork: optional(z.boolean()),
  artistPictures: optional(z.boolean()),
  artistBios: optional(z.boolean()),
  enabled: optional(z.boolean()),
});

export const MetadataSettingsSchema = z.strictObject({
  providers: z.array(providerSetting).max(20),
});

export const SpotifyAppSchema = z.strictObject({
  clientId: optional(z.string().max(100)),
  clientSecret: optional(z.string().max(200)),
  market: optional(z.string().max(2)),
});

/** A song link's service, searched for it (issue #169). */
export const LinkSearchTypeSchema = z.enum(["SPOTIFY", "APPLE_MUSIC", "DEEZER", "YOUTUBE"]);

/** The YouTube Data API's key (issue #169), for the song links' YouTube search; empty clears it. */
export const YouTubeKeySchema = z.strictObject({
  apiKey: z.string().trim().max(100),
});

export const MusicBrainzContactSchema = z.strictObject({
  contact: z.string().max(200),
});

export const AppleMusicKeySchema = z.strictObject({
  teamId: optional(z.string().max(20)),
  keyId: optional(z.string().max(20)),
  privateKey: optional(z.string().max(5000)),
  tokenUrl: optional(z.string().max(500)),
});

/** The languages an artist's bio is kept in (issue #86). */
export const BIO_LANGUAGES = ["en", "fr"] as const;

const artistName = z.string().min(1).max(300);

/** Artists are named in the query (?name=), as names can hold slashes. */
export const ArtistQuerySchema = z.strictObject({ name: artistName });

export const LookUpArtistSchema = z.strictObject({
  name: artistName,
  force: optional(z.boolean()).describe("Ask again even about what was found before (admins only)"),
});

export const ArtistBioSchema = z.strictObject({
  name: artistName,
  language: z.enum(BIO_LANGUAGES),
  text: z.string().max(5000),
});

/**
 * An artist's names (issue #512), set by an admin from the page of any of
 * them: the one shown (`main`, one of their names) and the others they're
 * also credited under. A name that's an artist of its own joins this one.
 */
export const ArtistNamesSchema = z.strictObject({
  name: artistName.describe("The artist, by any of their names"),
  main: artistName.describe("The name shown: this one, or one of `otherNames`"),
  otherNames: nameList({ max: 50, each: 300 }).describe("The other names they're credited under"),
});

export const ArtistSettingsSchema = z.strictObject({ enabled: z.boolean() });

/** A song's artwork, chosen among the matches (issue #85). */
export const SetArtworkSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/ }).max(2000),
});

export const ArtworkSettingsSchema = z.strictObject({
  enabled: optional(z.boolean()),
  country: optional(z.string().max(2)),
});
