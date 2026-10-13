import "../zod-config.js";
import { z } from "zod";
import { ENTITY_COLORS } from "../constants/index.js";
import { clearableText, optional } from "./fields.js";

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
});
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
});
export type UpdateOrganizationRequest = z.input<typeof UpdateOrganizationSchema>;

/** PUT /teams/:id/organization (the team's admins): the organisation it's part of, or null for none. */
export const SetTeamOrganizationSchema = z.strictObject({
  organizationId: z.string().min(1).nullable(),
});
export type SetTeamOrganizationRequest = z.input<typeof SetTeamOrganizationSchema>;
