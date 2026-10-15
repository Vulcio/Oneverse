import "../zod-config.js";
import { z } from "zod";
import { NOTE_PLACES, NoteAnchorSchema } from "../notes/index.js";
import { optional, requiredText } from "./fields.js";

/** Notes on songs (issue #256): what one says, where it's pinned and where it's saved. */
const content = requiredText(2000);
const id = z.string().min(1).max(40);

/** Where a note is saved, and the team, songbook or set that place needs (and nothing else). */
const placeFields = {
  place: z.enum(NOTE_PLACES).describe("Where it's saved, which decides who sees it: ME (you), TEAM, SONGBOOK, SET or SONG (written by the song's editors)"),
  teamId: optional(id).describe("For TEAM: the team"),
  songbookId: optional(id).describe("For SONGBOOK: the songbook, which has the song"),
  setlistId: optional(id).describe("For SET: the set, which has the song. For ME: only in this set"),
};

type PlaceFields = { place?: (typeof NOTE_PLACES)[number]; teamId?: string; songbookId?: string; setlistId?: string };
function checkPlace(note: PlaceFields, ctx: z.RefinementCtx) {
  const needs = { TEAM: "teamId", SONGBOOK: "songbookId", SET: "setlistId" } as const;
  if (!note.place) {
    // Changing a note: its place's team, songbook or set only with the place.
    for (const other of ["teamId", "songbookId", "setlistId"] as const) {
      if (note[other]) ctx.addIssue({ code: "custom", path: [other], message: `${other} needs place, where the note is moved to` });
    }
    return;
  }
  const field = needs[note.place as keyof typeof needs];
  if (field && !note[field]) ctx.addIssue({ code: "custom", path: [field], message: `${field} is needed for a note saved in a ${note.place.toLowerCase()}` });
  for (const other of ["teamId", "songbookId", "setlistId"] as const) {
    if (other !== field && note[other] && !(note.place === "ME" && other === "setlistId")) {
      ctx.addIssue({ code: "custom", path: [other], message: `${other} doesn't go with a note saved in ${note.place === "ME" ? "just me" : `a ${note.place.toLowerCase()}`}` });
    }
  }
}

export const CreateNoteSchema = z
  .strictObject({
    songVersionId: id,
    content,
    ...placeFields,
    anchor: NoteAnchorSchema.default({ kind: "song" }).describe("Where it's pinned; the whole song when left out"),
  })
  .superRefine(checkPlace);
export type CreateNoteRequest = z.input<typeof CreateNoteSchema>;

export const UpdateNoteSchema = z
  .strictObject({
    content: optional(content),
    anchor: optional(NoteAnchorSchema),
    resolved: optional(z.boolean()).describe("Resolved notes leave the chart and stay in their thread"),
    // Moved somewhere else (issue #262): its author only, under the same rules as a new note.
    place: optional(placeFields.place),
    teamId: placeFields.teamId,
    songbookId: placeFields.songbookId,
    setlistId: placeFields.setlistId,
  })
  .superRefine(checkPlace);
export type UpdateNoteRequest = z.input<typeof UpdateNoteSchema>;

export const NoteReplySchema = z.strictObject({ content });
export type NoteReplyRequest = z.input<typeof NoteReplySchema>;

/** GET /song-versions/:id/notes: the notes one sees on a song, opened from somewhere. */
export const ListNotesQuerySchema = z.strictObject({
  setlistId: optional(id).describe("Opened in this set: its notes too, and new notes saved in it by default"),
  songbookId: optional(id).describe("Opened from this songbook: new notes saved in it by default"),
});
