import "../zod-config.js";
import { z } from "zod";
import { STEM_PARTS } from "../stems/index.js";
import { clearableText, optional } from "./fields.js";

export const ATTACHMENT_TYPES = ["PDF", "CHORDPRO", "MUSICXML", "ABC_NOTATION", "TEXT", "IMAGE", "AUDIO", "OTHER"] as const;
export type AttachmentTypeValue = (typeof ATTACHMENT_TYPES)[number];
export const ATTACHMENT_VISIBILITIES = ["PRIVATE", "TEAM", "SONG", "SHARED"] as const;
export type AttachmentVisibilityValue = (typeof ATTACHMENT_VISIBILITIES)[number];

const visibility = z
  .enum(ATTACHMENT_VISIBILITIES)
  .describe(
    "Who sees it besides you: PRIVATE (nobody, the default), TEAM (teamId's members), SONG (everyone who sees the song) and SHARED (the people the song is shared with) need to manage the song.",
  );

/** A form field can't be left out once it's in the form: an empty one means none. */
const formField = <T extends z.ZodType>(schema: T) =>
  z
    .union([z.literal(""), schema], {
      // Not "Invalid input": what's wrong with the value, as the field's own schema says it.
      error: (issue) => (issue.code === "invalid_union" ? issue.errors[1]?.[0]?.message : undefined),
    })
    .transform((value) => (value === "" ? undefined : value) as z.output<T> | undefined)
    .optional();

/** A number in a form field ("92.5"). */
const formNumber = (field: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/, { message: `${field} must be a number` })
    .transform(Number)
    .pipe(z.number().min(min).max(max));

/** A multitrack's id (issue #123): made by the app that starts one, the same for every file of it. */
const multitrackId = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/, { message: "multitrackId must be 8 to 40 letters, digits, - or _" });
const multitrackName = z.string().trim().max(60);
/** "4/4", "6/8", "7/8"… */
export const TIME_SIGNATURE_PATTERN = /^([1-9]|1[0-9])\/(1|2|4|8|16)$/;
const timeSignature = z.string().trim().regex(TIME_SIGNATURE_PATTERN, { message: "recordingTimeSignature must read like 4/4 or 6/8" });

/** The form fields sent with an uploaded file (multipart); an audio file's recording details as with PATCH. */
export const UploadAttachmentSchema = z.strictObject({
  type: z.enum(ATTACHMENT_TYPES),
  stemPart: formField(z.enum(STEM_PARTS)),
  /** Its own name for the part (issue #131): "Descant", "Acoustic guitar". */
  partName: formField(z.string().trim().max(40)),
  visibility: formField(visibility),
  teamId: formField(z.string()),
  multitrackId: formField(multitrackId),
  multitrackName: formField(multitrackName),
  recordingKey: formField(z.string().trim().max(12)),
  recordingTempo: formField(formNumber("recordingTempo", 20, 400)),
  recordingTimeSignature: formField(timeSignature),
  recordingFirstBeat: formField(formNumber("recordingFirstBeat", 0, 600)),
  /** Played freely before its first beat (issue #178): no click until then. */
  recordingFreeIntro: formField(z.enum(["true", "false"]).transform((value) => value === "true")),
  /** Recorded this many semitones above its multitrack (issue #135): while the player was transposed. */
  pitchOffset: formField(formNumber("pitchOffset", -12, 12).pipe(z.number().int())),
  multitrackSetlistId: formField(z.string().max(40)),
  /**
   * A recorded take (issue #127), turned into Opus by the Worker: "encode"
   * alone, or with "voice" (RNNoise, #132), "level" (even out its level)
   * and "noise" (reduce background noise), comma-separated. Only for a WAV
   * file.
   */
  process: formField(z.string().regex(/^encode(,(voice|level|noise))*$/, { message: "process must be encode, then voice, level and noise if wanted, comma-separated" })),
  /** Kept as another take of its part, not played (issue #127). */
  otherTake: formField(z.enum(["true", "false"]).transform((value) => value === "true")),
});

/** What's left out stays as it is; null clears it. */
export const UpdateAttachmentSchema = z.strictObject({
  stemPart: z.enum(STEM_PARTS).nullable().optional(),
  /** Its own name for the part (issue #131); "" or null: the part's. */
  partName: clearableText(40),
  recordingKey: z.string().max(12).nullable().optional(),
  recordingTempo: z.number().min(20).max(400).nullable().optional(),
  recordingFirstBeat: z.number().min(0).max(600).nullable().optional(),
  /**
   * Its beat moved by hand (issue #448), the detected beats and bars kept:
   * `seconds` moves them all, `beats` moves the bars that many beats later
   * (earlier when negative) on the same beats.
   */
  recordingBeatShift: z.strictObject({ seconds: z.number().min(-2).max(2).optional(), beats: z.number().int().min(-16).max(16).optional() }).optional(),
  /** Played freely before its first beat (issue #178): the click waits for it, rather than clicking from 0:00. */
  recordingFreeIntro: z.boolean().optional(),
  recordingTimeSignature: timeSignature.nullable().optional(),
  /** Recorded this many semitones above its multitrack (issue #135); null for none. */
  pitchOffset: z.number().int().min(-12).max(12).nullable().optional(),
  /** Null: the song's original stems. */
  multitrackId: multitrackId.nullable().optional(),
  multitrackName: multitrackName.transform((value) => value || null).nullable().optional(),
  /** The set its multitrack was recorded for (issue #127); null for none. */
  multitrackSetlistId: z.string().max(40).nullable().optional(),
  /** Another take, not played (true), or the one played (false) - see UseTakeSchema to swap. */
  otherTake: z.boolean().optional(),
  /** Kept as uploaded (issue #145): not deleted, replaced, merged or cleaned up; for its uploader to change. */
  locked: z.boolean().optional(),
  /** The details a separation's analysis found (issue #175), confirmed as they are. Changing one confirms it too. */
  confirmDetected: z.literal(true).optional(),
  /** Where each section starts in the recording (issue #110); null or [] for none. */
  cuePoints: z
    .array(z.strictObject({ at: z.number().min(0).max(3600), sectionId: z.string().min(1).max(64) }))
    .max(200, "cuePoints must have at most 200 cue points")
    .nullable()
    .optional(),
  visibility: optional(visibility),
  teamId: optional(z.string()),
});
/** Cleans up an audio file afterwards (issue #132), in the Worker: what to do to it; it comes back as Opus. */
export const ProcessAttachmentSchema = z.strictObject({
  steps: z.array(z.enum(["voice", "level", "noise"])).min(1, "steps must name at least one of voice, level and noise"),
});

/** Plays this take of a part (issue #127), instead of another file of the multitrack, which becomes another take. */
export const UseTakeSchema = z.strictObject({
  instead: z.string().max(40).nullable().optional(),
});

export type UpdateAttachmentRequest = z.input<typeof UpdateAttachmentSchema>;

export const BULK_UPLOAD_TYPES = ["CHORDPRO", "PDF"] as const;
export type BulkUploadTypeValue = (typeof BULK_UPLOAD_TYPES)[number];

export const BulkUploadCommitSchema = z.strictObject({ type: z.enum(BULK_UPLOAD_TYPES) });

export const BulkUploadPreviewSchema = z.strictObject({
  filenames: z.array(z.string()).min(1),
  type: z.enum(BULK_UPLOAD_TYPES).optional().describe("The kind being uploaded: files of another kind are left out (issue #201)"),
});

/**
 * The largest song file of each type (issue #163), in MB: set in Admin >
 * Storage, else these. Uploads are held in the API's memory until they're
 * stored, hence a ceiling.
 */
export const BUILT_IN_FILE_SIZE_LIMITS_MB: Record<AttachmentTypeValue, number> = {
  PDF: 25,
  CHORDPRO: 25,
  MUSICXML: 25,
  ABC_NOTATION: 25,
  TEXT: 25,
  IMAGE: 25,
  AUDIO: 50,
  OTHER: 25,
};
export const MAX_FILE_SIZE_LIMIT_MB = 500;

/** PUT /admin/storage/file-size-limits: a type left out keeps its limit; null goes back to the built-in one. */
export const SaveFileSizeLimitsSchema = z.strictObject({
  limitsMb: z.partialRecord(
    z.enum(ATTACHMENT_TYPES),
    z.number().int().min(1, "a file size limit must be at least 1 MB").max(MAX_FILE_SIZE_LIMIT_MB, `a file size limit can't be more than ${MAX_FILE_SIZE_LIMIT_MB} MB`).nullable(),
  ),
});
export type SaveFileSizeLimitsRequest = z.input<typeof SaveFileSizeLimitsSchema>;
