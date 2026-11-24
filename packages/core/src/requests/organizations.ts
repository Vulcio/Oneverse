import "../zod-config.js";
import { z } from "zod";
import { ENTITY_COLORS } from "../constants/index.js";
import { FILLABLE_ROLES } from "../calendar/index.js";
import { clearableInt, clearableText, optional, queryBoolean } from "./fields.js";
import { countryHasPostalCodes, isCountryCode, postalCodeFits, readPhone, tidyPostalCode } from "../addresses/index.js";

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
  reviewRequests: z.boolean().nullable().optional().describe("With anyone allowed, people ask for an organisation and a global admin approves it (ORGANIZATIONS_REVIEWED, issue #364)"),
  addressLookup: z.boolean().nullable().optional().describe("Suggest addresses as they're typed and look them up when a request is sent (ADDRESS_LOOKUP, issue #533)"),
  photonUrl: z.union([z.literal(""), z.string().trim().max(300).pipe(z.url({ protocol: /^https?$/ }))]).nullable().optional().describe("The Photon server for addresses outside France (PHOTON_URL; default https://photon.komoot.io)"),
  addressLookupFrance: z.boolean().nullable().optional().describe("French addresses from the Base Adresse Nationale (ADDRESS_LOOKUP_FRANCE; default on)"),
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

/** PUT /organizations/:id/storage/limits (its admins): what may go into its own bucket; null clears a limit, left out keeps it. */
export const OwnStorageLimitsSchema = z.strictObject({
  teamLimitMb: clearableInt(1, 10_000_000).describe("What each of its teams may keep there, in MB, unless one of its roles given to the team has a storage tier"),
  memberLimitMb: clearableInt(1, 10_000_000).describe("What each of its roles' holders may upload there, in MB, unless a role of theirs has a storage tier"),
  maxFileMb: clearableInt(1, 500).describe("The largest file, in MB; the server's own limits still apply"),
});
export type OwnStorageLimitsRequest = z.input<typeof OwnStorageLimitsSchema>;
export type SaveOrganizationSettingsRequest = z.input<typeof SaveOrganizationSettingsSchema>;

/** POST /organizations, POST /admin/organizations. */
export const CreateOrganizationSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  description: optional(z.string().trim().max(500)),
  adminEmail: optional(z.string().trim().toLowerCase().max(320).pipe(z.email())).describe("Admin only: who runs it, if not the global admin making it"),
});
export type CreateOrganizationRequest = z.input<typeof CreateOrganizationSchema>;

/** What an organisation is, asked when someone requests one (issue #364). */
export const ORGANIZATION_KINDS = ["CHURCH", "SCHOOL", "ASSOCIATION", "CHOIR", "BUSINESS", "OTHER"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];
/** About how many people it has. */
export const ORGANIZATION_SIZES = ["UP_TO_20", "UP_TO_100", "UP_TO_500", "MORE"] as const;
export type OrganizationSize = (typeof ORGANIZATION_SIZES)[number];

/**
 * POST /organizations/requests (issue #364): someone asks for an
 * organisation, reviewed by a global admin. One that looks like an existing
 * organisation or request (same name, near enough, in the same city) is
 * refused with them, unless `duplicateNote` says why it isn't the same.
 */
/** An organisation's address (issue #533): a country we know, and a postal code in its format where it has them. */
const countryField = z.string().trim().toUpperCase().refine(isCountryCode, "country must be a country's two-letter code, like FR").describe("ISO 3166-1 alpha-2, like FR");
const postalCodeField = z.string().trim().max(20).transform(tidyPostalCode);
const streetField = z.string().trim().min(3).max(200).describe("Number and street, as on a letter");
const personName = z.string().trim().min(1).max(100);

const phoneField = z.string().trim().min(3).max(40).describe("With its + and country code, or as written in the address's country; checked to be a number that can exist, kept as +33612345678");

function checkPostalCode(value: { country?: string; postalCode?: string; phone?: string }, ctx: z.RefinementCtx) {
  // A phone number that can exist (issue #533), read in the address's country unless it has its own code.
  if (value.phone && !readPhone(value.phone, value.country)) ctx.addIssue({ code: "custom", path: ["phone"], message: "phone isn't a phone number that can exist (add its country code, like +33)" });
  if (!value.country) return;
  if (!countryHasPostalCodes(value.country)) return;
  if (!value.postalCode) ctx.addIssue({ code: "custom", path: ["postalCode"], message: "postalCode is needed in that country" });
  else if (!postalCodeFits(value.country, value.postalCode)) ctx.addIssue({ code: "custom", path: ["postalCode"], message: "postalCode doesn't look like a postal code in that country" });
}

/** What's told about an organisation when asking for one, in the app or at sign-up. */
const organizationDetails = {
  name: z.string().trim().min(2).max(100),
  description: optional(z.string().trim().max(500)),
  kind: z.enum(ORGANIZATION_KINDS),
  city: z.string().trim().min(2).max(100).describe("Where it is: tells two of the same name apart"),
  website: optional(z.string().trim().max(300).pipe(z.url({ protocol: /^https?$/ }))),
  peopleCount: optional(z.enum(ORGANIZATION_SIZES)),
  duplicateNote: optional(z.string().trim().min(5).max(500)).describe("Why it isn't one of those it looks like"),
};

/**
 * POST /organizations/requests (issue #364): someone asks for an
 * organisation, reviewed by a global admin. One that looks like an existing
 * organisation or request (same name, near enough, in the same city or at
 * the same address) is refused with them, unless `duplicateNote` says why
 * it isn't the same; one at the same address with nearly the same name is
 * refused anyway (`ORGANIZATION_EXISTS`, issue #533).
 */
export const RequestOrganizationSchema = z
  .strictObject({
    ...organizationDetails,
    contactName: z.string().trim().min(2).max(100).describe("Who to reach about it"),
    contactEmail: z.string().trim().toLowerCase().max(320).pipe(z.email()),
    street: optional(streetField),
    postalCode: optional(postalCodeField),
    country: optional(countryField),
    responsibleFirstName: optional(personName).describe("The person responsible for it (issue #533)"),
    responsibleLastName: optional(personName),
    phone: optional(phoneField),
  })
  .superRefine(checkPostalCode);
export type RequestOrganizationRequest = z.input<typeof RequestOrganizationSchema>;

/**
 * POST /auth/organization-signup (issue #533): signed out, when sign-up is
 * by asking for an organisation. The same as asking in the app, with the
 * address and the person responsible needed; who to reach is the account
 * made next. Kept for that account (a pass in a cookie, as an invitation's).
 */
export const OrganizationSignupSchema = z
  .strictObject({
    ...organizationDetails,
    street: streetField,
    postalCode: postalCodeField.optional(),
    country: countryField,
    responsibleFirstName: personName.describe("The person responsible for it"),
    responsibleLastName: personName,
    phone: phoneField.describe("A phone number to reach it or the person responsible: checked, never texted"),
  })
  .superRefine(checkPostalCode);
export type OrganizationSignupRequest = z.input<typeof OrganizationSignupSchema>;

/** POST /admin/organizations/requests/:id/decline: why, told to who asked. */
export const DeclineOrganizationRequestSchema = z.strictObject({
  reason: optional(z.string().trim().max(500)),
});
export type DeclineOrganizationRequestRequest = z.input<typeof DeclineOrganizationRequestSchema>;

/** GET /auth/address-suggestions (issue #533): what's typed of an address, in a country. */
export const AddressSuggestionsQuerySchema = z.strictObject({
  q: z.string().max(200).describe("What's typed of the address"),
  country: optional(countryField),
  lang: optional(z.string().trim().max(10).describe("The language to name places in (en, fr, de, it)")),
});
export type AddressSuggestionsQuery = z.input<typeof AddressSuggestionsQuerySchema>;

/** PATCH /organizations/:id (its admins): a field left out keeps its value. */
export const UpdateOrganizationSchema = z.strictObject({
  name: optional(z.string().trim().min(2).max(100)),
  description: clearableText(500),
  color: z.enum(ENTITY_COLORS).nullable().optional().describe("Its colour; null: one derived from its name"),
  bible: optional(z.boolean().describe("A Bible in its teams' members' sidebar (issue #310)")),
  city: clearableText(100),
  street: clearableText(200),
  postalCode: clearableText(20),
  country: z.union([z.literal(""), countryField]).nullable().optional().describe("null or \"\" clears it"),
  responsibleFirstName: clearableText(100),
  responsibleLastName: clearableText(100),
  phone: z.union([z.literal(""), phoneField]).nullable().optional().describe("null or \"\" clears it"),
  contactName: clearableText(100),
  contactEmail: z.union([z.literal(""), z.string().trim().toLowerCase().max(320).pipe(z.email())]).nullable().optional().describe("null or \"\" clears it"),
  website: z.union([z.literal(""), z.string().trim().max(300).pipe(z.url({ protocol: /^https?$/ }))]).nullable().optional(),
  onboardingDone: optional(z.boolean().describe("Its admins put the setup checklist away (true) or bring it back")),
}).superRefine((value, ctx) => {
  if (value.phone && !readPhone(value.phone, value.country || undefined)) ctx.addIssue({ code: "custom", path: ["phone"], message: "phone isn't a phone number that can exist (add its country code, like +33)" });
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
  usesSongverse: z.boolean().optional().describe("A Songverse team (its own songs, songbooks, arrangements), or one that only plans (the default); both have sets"),
  parentId: optional(z.string().min(1)).describe("The group it's under, in the same organisation"),
});
export type CreateGroupRequest = z.input<typeof CreateGroupSchema>;

/** PATCH /teams/:id/group (the team's admins): a field left out keeps its value; parentId null puts it at the top. */
export const UpdateGroupSchema = z.strictObject({
  usesSongverse: z.boolean().optional(),
  fills: z
    .array(z.enum(FILLABLE_ROLES as unknown as [string, ...string[]]))
    .max(FILLABLE_ROLES.length)
    .optional()
    .describe("The roles it fills at its organisation's events (issue #549): Music, Media operator, Audio operator, Lights, Technician"),
  parentId: z.string().min(1).nullable().optional(),
  confirmOffers: z.boolean().optional().describe("Its members' offers to fill a place wait for an admin to confirm them (issue #559)"),
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
