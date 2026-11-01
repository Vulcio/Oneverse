import "../zod-config.js";
import { z } from "zod";
import { ENTITY_COLORS } from "../constants/index.js";
import { clearableText, optional, queryBoolean } from "./fields.js";

/**
 * Organisations (issue #241, Planiverse): whether an instance has none
 * (Songverse alone), one (everyone who signs in is in it) or several.
 */
export const ORGANIZATION_MODES = ["NONE", "SINGLE", "MULTI"] as const;
export type OrganizationMode = (typeof ORGANIZATION_MODES)[number];

/** PUT /admin/organizations/settings: a field left out keeps its value; null goes back to its env var, then the default. */
export const SaveOrganizationSettingsSchema = z.strictObject({
  mode: z.enum(ORGANIZATION_MODES).nullable().optional().describe("None, one or several organisations (ORGANIZATION_MODE)"),
  anyoneCreates: z.boolean().nullable().optional().describe("With several, anyone may create one, not only global admins (ORGANIZATIONS_OPEN)"),
  ownStorage: z.boolean().nullable().optional().describe("Organisations may keep their teams' files in their own bucket, set up by an admin with a role that allows it (ORGANIZATIONS_OWN_STORAGE, issue #206)"),
});

/**
 * PUT /organizations/:id/storage (issue #206): an organisation's own bucket,
 * at a known provider. Like PATCH for the secret: left out keeps it.
 */
export const OWN_STORAGE_PROVIDER_NAMES = ["R2", "S3", "B2", "WASABI"] as const;
export const SaveOwnStorageSchema = z.strictObject({
  provider: z.enum(OWN_STORAGE_PROVIDER_NAMES).describe("Cloudflare R2, Amazon S3, Backblaze B2 or Wasabi"),
  accountId: optional(z.string().trim().toLowerCase().max(64)).describe("R2: the Cloudflare account's ID"),
  region: optional(z.string().trim().toLowerCase().max(40)).describe("S3, B2, Wasabi: the bucket's region, like eu-central-1 or us-west-004"),
  bucket: z.string().trim().min(3).max(63),
  accessKeyId: optional(z.string().trim().min(1).max(200)).describe("Needed the first time; left out, the one saved is kept"),
  secretAccessKey: optional(z.string().trim().min(1).max(500)).describe("Needed the first time; left out, the one saved is kept"),
});
export type SaveOwnStorageRequest = z.input<typeof SaveOwnStorageSchema>;
export type SaveOrganizationSettingsRequest = z.input<typeof SaveOrganizationSettingsSchema>;

/** POST /organizations, POST /admin/organizations. */
export const CreateOrganizationSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  description: optional(z.string().trim().max(500)),
  adminEmail: optional(z.string().trim().toLowerCase().max(320).pipe(z.email())).describe("Admin only: who runs it, if not the global admin making it"),
});
export type CreateOrganizationRequest = z.input<typeof CreateOrganizationSchema>;

/** PATCH /organizations/:id (its admins): a field left out keeps its value. */
export const UpdateOrganizationSchema = z.strictObject({
  name: optional(z.string().trim().min(2).max(100)),
  description: clearableText(500),
  color: z.enum(ENTITY_COLORS).nullable().optional().describe("Its colour; null: one derived from its name"),
  bible: optional(z.boolean().describe("A Bible in its teams' members' sidebar (issue #310)")),
});
export type UpdateOrganizationRequest = z.input<typeof UpdateOrganizationSchema>;

/** PUT /teams/:id/organization (the team's admins): the organisation it's part of, or null for none. */
export const SetTeamOrganizationSchema = z.strictObject({
  organizationId: z.string().min(1).nullable(),
});
export type SetTeamOrganizationRequest = z.input<typeof SetTeamOrganizationSchema>;

/** POST /organizations/:id/groups (its admins): a group of the organisation, under another one or not. */
export const CreateGroupSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  description: optional(z.string().trim().max(500)),
  usesSongverse: z.boolean().optional().describe("A Songverse team (songs, songbooks, sets), or one that only plans (the default)"),
  parentId: optional(z.string().min(1)).describe("The group it's under, in the same organisation"),
});
export type CreateGroupRequest = z.input<typeof CreateGroupSchema>;

/** PATCH /teams/:id/group (the team's admins): a field left out keeps its value; parentId null puts it at the top. */
export const UpdateGroupSchema = z.strictObject({
  usesSongverse: z.boolean().optional(),
  parentId: z.string().min(1).nullable().optional(),
});
export type UpdateGroupRequest = z.input<typeof UpdateGroupSchema>;

/** A group's own position: "Greeter", "Coffee". */
export const TeamPositionSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
});

/** PUT /teams/:id/members/:userId/positions (themselves or the team's admins): the group's positions they cover. */
export const SetMemberPositionsSchema = z.strictObject({
  positionIds: z.array(z.string().min(1)).max(100),
});

/** GET /teams: Songverse's teams, or with `all` the groups that only plan too. */
export const ListTeamsQuerySchema = z.strictObject({
  all: optional(queryBoolean()),
});
