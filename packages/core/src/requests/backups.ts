import "../zod-config.js";
import { z } from "zod";
import { clearableInt, optional } from "./fields.js";

/**
 * PUT /admin/backups/config (issue #119): where the server's backups go and
 * when. Like PATCH: a field left out keeps its value; "" clears a text field
 * and null a number or the switch, which then come from their BACKUP_* env
 * var, else the default. The secret is write-only, never sent back.
 */
export const SaveBackupConfigSchema = z.strictObject({
  enabled: z.boolean().nullable().optional().describe("Whether the nightly backup runs; null: BACKUP_ENABLED, else on once a bucket is set"),
  endpoint: optional(z.string().trim().max(500).describe("The S3-compatible endpoint (R2, Backblaze B2, S3, MinIO…)")),
  region: optional(z.string().trim().max(100)),
  bucket: optional(z.string().trim().max(200)),
  prefix: optional(z.string().trim().max(200).regex(/^[\w./-]*$/, "prefix must be letters, digits, dots, dashes, underscores and slashes")),
  accessKeyId: optional(z.string().trim().max(200)),
  secretAccessKey: optional(z.string().max(500)),
  hourUtc: clearableInt(0, 23).describe("The hour of the day (UTC) the nightly backup starts at"),
  keepDaily: clearableInt(1, 365),
  keepWeekly: clearableInt(0, 520),
  keepMonthly: clearableInt(0, 240),
  fileRetentionDays: clearableInt(0, 3650).describe("How long a file deleted from the main storage stays in the backup"),
});
export type SaveBackupConfigRequest = z.input<typeof SaveBackupConfigSchema>;

/** Whose archives (issue #351): your own, a team's or an organisation's (its admins'). */
export const ARCHIVE_SCOPES = ["user", "team", "organization"] as const;
export type ArchiveScopeName = (typeof ARCHIVE_SCOPES)[number];

const archiveOwner = {
  scope: z.enum(ARCHIVE_SCOPES).describe("user: yours; team or organization: one you're an admin of, named by id"),
  id: optional(z.string().min(1).max(40)).describe("The team's or organisation's id; left out for your own"),
};
const ownerNamed = (owner: { scope: ArchiveScopeName; id?: string }) => owner.scope === "user" || !!owner.id;
const ownerMessage = "id is needed for a team's or an organisation's archives";

/** GET /archives and POST /archives (make one now): whose. */
export const ArchiveOwnerSchema = z.strictObject(archiveOwner).refine(ownerNamed, ownerMessage);
export type ArchiveOwnerRequest = z.input<typeof ArchiveOwnerSchema>;

/** PUT /archives/schedule: a new archive every week, or not. */
export const ArchiveScheduleSchema = z.strictObject({ ...archiveOwner, weekly: z.boolean().describe("Make one every week") }).refine(ownerNamed, ownerMessage);
export type ArchiveScheduleRequest = z.input<typeof ArchiveScheduleSchema>;
