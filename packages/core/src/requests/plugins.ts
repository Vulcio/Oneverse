import "../zod-config.js";
import { z } from "zod";
import { SONG_PROVIDER_HOOKS } from "../song-provider/index.js";
import { optional, queryText, requiredText } from "./fields.js";

/** A plugin turned on or off (issue #157, Admin > Plugins). */
export const PluginEnabledSchema = z.strictObject({ enabled: z.boolean() });

const hooks = z.array(z.enum(SONG_PROVIDER_HOOKS)).max(SONG_PROVIDER_HOOKS.length);

/** A Song provider API server added to the Song provider plugin (issue #157). */
export const SongProviderSourceSchema = z.strictObject({
  /** Left out: the name it gives itself. */
  name: optional(z.string().trim().max(100)),
  apiUrl: requiredText(500),
  /** Its Bearer key; left out keeps the one saved, empty clears it. */
  apiKey: optional(z.string().trim().max(1000)),
  allowPrivate: optional(z.boolean()),
  /** What it's asked for; left out, everything it says it answers. */
  hooks: optional(hooks),
  enabled: optional(z.boolean()),
});
export type SongProviderSourceInput = z.input<typeof SongProviderSourceSchema>;

/** A change to one: only the fields sent. */
export const SongProviderSourceUpdateSchema = SongProviderSourceSchema.partial();
export type SongProviderSourceUpdate = z.input<typeof SongProviderSourceUpdateSchema>;

/** The servers' order, by ID. */
export const SongProviderOrderSchema = z.strictObject({ ids: z.array(z.string().max(40)).max(50) });

/** Find chords (issue #157): a song's chords and lyrics searched for at the Song providers. */
export const ChordSearchQuerySchema = z.strictObject({
  title: queryText(300).pipe(z.string().min(1, "title should not be empty")),
  artist: optional(queryText(300)),
  language: optional(queryText(20)),
});

/** Which of a song's versions Find chords takes the chart of (issue #369); left out, the song's default chart. */
export const ChordContentQuerySchema = z.strictObject({
  version: optional(queryText(200)),
});
