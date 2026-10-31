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
