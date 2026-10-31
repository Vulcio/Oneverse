import "../zod-config.js";
import { z } from "zod";
import { ATTACHMENT_VISIBILITIES } from "./files.js";
import { clearableInt, optional, requiredText } from "./fields.js";

const visibility = z
  .enum(ATTACHMENT_VISIBILITIES)
  .describe("Who sees it besides you, as with files: PRIVATE (the default), TEAM (teamId's members); SONG and SHARED need to manage the song.");
const url = z.string().trim().min(1).max(2000).describe("A YouTube, Spotify, Apple Music or Deezer address, or any https address");
const startSeconds = clearableInt(0, 36_000).describe("Where to start playing, in seconds; left out, the address's own t= if it has one");

/** POST a song's reference recording (issue #346). */
export const CreateSongLinkSchema = z.strictObject({
  url,
  label: requiredText(80),
  startSeconds,
  visibility: optional(visibility),
  teamId: optional(z.string()),
});
export type CreateSongLinkRequest = z.input<typeof CreateSongLinkSchema>;

/** PATCH it: a field left out is kept. */
export const UpdateSongLinkSchema = z.strictObject({
  url: optional(url),
  label: optional(requiredText(80)),
  startSeconds,
  visibility: optional(visibility),
  teamId: optional(z.string()),
});
export type UpdateSongLinkRequest = z.input<typeof UpdateSongLinkSchema>;
