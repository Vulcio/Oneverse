import "../zod-config.js";
import { z } from "zod";
import { optional } from "./fields.js";

/**
 * Roles (issue #160): what someone may do beyond their own and their teams'
 * songs, given to users and to teams in Admin.
 */
const roleFields = {
  name: z.string().trim().min(1, "name must not be empty").max(60),
  description: z.string().trim().max(300),
  canReview: z.boolean(),
  canSeparateStems: z.boolean(),
  canKeepLosslessAudio: z.boolean().describe("Lossless audio uploads keep their original, as FLAC"),
  canUploadAudio: z.boolean().describe("Uploads audio files (recording in Songverse needs no role)"),
  canOperateScreens: z.boolean().describe("Controls what's presented on the screens of the sets they can open, beside the set's leader"),
  canCue: z.boolean().describe("Moves the screens of the sets they can open to the next or previous song or section (issue #322)"),
  canRoute: z.boolean().describe("Changes what the screens of the sets they can open draw - their layers and overlays - without presenting (issue #322)"),
  canManageScreens: z.boolean().describe("Pairs, changes and disconnects the screens of their teams and organisations, without being their admin (issue #322)"),
  teamAssignable: z.boolean().describe("A team's or an organisation's admins give it to their own members, only on their team or organisation (issue #270)"),
  stemSeparationMonthlyLimit: z.number().int().min(1).max(10_000).nullable().describe("Null uses Admin > Stem separation's"),
  storageLimitMb: z.number().int().min(0).max(1_000_000).nullable().describe("A storage tier (MB); null gives none"),
};

/** POST /admin/roles */
export const CreateRoleSchema = z.strictObject({
  name: roleFields.name,
  description: optional(roleFields.description),
  canReview: optional(roleFields.canReview),
  canSeparateStems: optional(roleFields.canSeparateStems),
  canKeepLosslessAudio: optional(roleFields.canKeepLosslessAudio),
  canUploadAudio: optional(roleFields.canUploadAudio),
  canOperateScreens: optional(roleFields.canOperateScreens),
  canCue: optional(roleFields.canCue),
  canRoute: optional(roleFields.canRoute),
  canManageScreens: optional(roleFields.canManageScreens),
  teamAssignable: optional(roleFields.teamAssignable),
  stemSeparationMonthlyLimit: roleFields.stemSeparationMonthlyLimit.optional(),
  storageLimitMb: roleFields.storageLimitMb.optional(),
});
export type CreateRoleRequest = z.input<typeof CreateRoleSchema>;
export type CreateRoleInput = z.output<typeof CreateRoleSchema>;

/** PATCH /admin/roles/:id: a field left out keeps its value. */
export const UpdateRoleSchema = z.strictObject({
  name: optional(roleFields.name),
  description: optional(roleFields.description),
  canReview: optional(roleFields.canReview),
  canSeparateStems: optional(roleFields.canSeparateStems),
  canKeepLosslessAudio: optional(roleFields.canKeepLosslessAudio),
  canUploadAudio: optional(roleFields.canUploadAudio),
  canOperateScreens: optional(roleFields.canOperateScreens),
  canCue: optional(roleFields.canCue),
  canRoute: optional(roleFields.canRoute),
  canManageScreens: optional(roleFields.canManageScreens),
  teamAssignable: optional(roleFields.teamAssignable),
  stemSeparationMonthlyLimit: roleFields.stemSeparationMonthlyLimit.optional(),
  storageLimitMb: roleFields.storageLimitMb.optional(),
});
export type UpdateRoleRequest = z.input<typeof UpdateRoleSchema>;
export type UpdateRoleInput = z.output<typeof UpdateRoleSchema>;

/** PUT /admin/users/:id/roles and /admin/teams/:id/roles: the roles they have from now on. */
export const AssignRolesSchema = z.strictObject({
  roleIds: z.array(z.string().min(1).max(40)).max(100),
});
export type AssignRolesRequest = z.input<typeof AssignRolesSchema>;

/** Admin > Instruments (issue #166): an instrument added to the list, its name in English and French. */
const instrumentFields = {
  label: z.string().trim().min(1, "label must not be empty").max(40),
  labelFr: z.string().trim().max(40).describe("Empty: the English name"),
};

/** POST /admin/instruments */
export const CreateInstrumentSchema = z.strictObject({
  label: instrumentFields.label,
  labelFr: optional(instrumentFields.labelFr),
});
export type CreateInstrumentRequest = z.input<typeof CreateInstrumentSchema>;

/** PATCH /admin/instruments/:id: a field left out keeps its value. */
export const UpdateInstrumentSchema = z.strictObject({
  label: optional(instrumentFields.label),
  labelFr: optional(instrumentFields.labelFr),
});
export type UpdateInstrumentRequest = z.input<typeof UpdateInstrumentSchema>;
