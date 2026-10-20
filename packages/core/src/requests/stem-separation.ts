import "../zod-config.js";
import { z } from "zod";
import { optional } from "./fields.js";

/**
 * Splitting a recording into stems with the Demucs API (issue #63): 4 parts
 * (htdemucs: vocals, drums, bass, other), 6 (htdemucs_6s: and guitar,
 * piano) or 2 (the vocals and the rest).
 */
export const STEM_SEPARATION_PARTS = ["4", "6", "2"] as const;
export type StemSeparationParts = (typeof STEM_SEPARATION_PARTS)[number];

/** POST /song-versions/:id/attachments/:attachmentId/separate */
export const StartStemSeparationSchema = z.strictObject({
  parts: z.enum(STEM_SEPARATION_PARTS).default("4"),
  /** Replace the stems of this recording's latest separation once the new ones are in (issue #175): its sections and who sees it carry over, recordings made into it move. */
  replace: optional(z.boolean()),
});
export type StartStemSeparationRequest = z.input<typeof StartStemSeparationSchema>;

const modelName = z.string().trim().regex(/^[a-z0-9_]{1,40}$/, "model must be a Demucs model's name, like htdemucs");

/**
 * PUT /admin/stem-separation: a field left out keeps its value; the key, a
 * secret, is never sent back - empty keeps it; null clears a field (back to
 * its env var, else the default).
 */
export const SaveStemSeparationSettingsSchema = z.strictObject({
  apiUrl: z.url({ protocol: /^https?$/, message: "apiUrl must be the Demucs API's address, http:// or https://" }).max(500).nullable().optional(),
  apiKey: optional(z.string().max(500)),
  fastModel: modelName.nullable().optional(),
  hqModel: modelName.nullable().optional(),
  hqEnabled: z.boolean().nullable().optional(),
  monthlyLimit: z.number().int().min(1).max(10_000).nullable().optional(),
  /** Teams and organisations may connect their own Songverse Sonic servers (issue #300), and those on private or local addresses. */
  ownServers: z.boolean().nullable().optional(),
  ownServersPrivate: z.boolean().nullable().optional(),
});
export type SaveStemSeparationSettingsRequest = z.input<typeof SaveStemSeparationSettingsSchema>;

/**
 * PUT /teams/:id/sonic-server and /organizations/:id/sonic-server (issue
 * #300): a team's or an organisation's own Songverse Sonic server. The
 * address and key are needed the first time; after that a field left out
 * keeps its value, an empty key keeps the saved one, and null clears a
 * model or the limit (back to the defaults, no limit).
 */
export const SaveSonicServerSchema = z.strictObject({
  apiUrl: optional(z.url({ protocol: /^https?$/, message: "apiUrl must be the Sonic server's address, http:// or https://" }).max(500)),
  apiKey: optional(z.string().max(500)),
  fastModel: modelName.nullable().optional(),
  hqModel: modelName.nullable().optional(),
  hqEnabled: optional(z.boolean()),
  monthlyLimit: z.number().int().min(1).max(10_000).nullable().optional(),
});
export type SaveSonicServerRequest = z.input<typeof SaveSonicServerSchema>;
