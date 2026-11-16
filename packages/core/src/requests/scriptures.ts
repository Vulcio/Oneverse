import "../zod-config.js";
import { z } from "zod";
import { clearableInt, clearableText, optional } from "./fields.js";

/** The longest YouVersion passages may be kept (issue #485): a week. */
export const YOUVERSION_CACHE_HOURS_MAX = 168;

/**
 * YouVersion's settings (issues #304, #485), each left out kept: the App Key
 * (empty clears the saved one), and how many hours passages are kept - 0
 * never (the default), null back to YOUVERSION_CACHE_HOURS.
 */
export const YouVersionKeySchema = z.strictObject({
  appKey: optional(z.string().trim().max(200)),
  cacheHours: clearableInt(0, YOUVERSION_CACHE_HOURS_MAX),
});

/** The YouVersion versions in a language (issue #304): a BCP 47 tag ("fr", "en-GB"). */
export const YouVersionBiblesQuerySchema = z.strictObject({
  language: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/, "language must be a language tag, like en or fr"),
});

/** A passage of a YouVersion version (issue #304), as people write it: "John 3:16-18", "Jean 3.16". */
export const YouVersionPassageQuerySchema = z.strictObject({
  reference: z.string().trim().min(1).max(200),
});

/** An imported Bible's details and what it may be used for (issue #301), as the admin sets them. */
export const BibleUpdateSchema = z.strictObject({
  name: optional(z.string().trim().min(1).max(200)),
  abbreviation: clearableText(20),
  copyright: clearableText(2000),
  canProject: optional(z.boolean()),
  canOffline: optional(z.boolean()),
  canExport: optional(z.boolean()),
});

/** A passage of an imported Bible (issue #301), as people write it: "John 3:16-18", "Psaume 23,1-4". */
export const BiblePassageQuerySchema = z.strictObject({
  reference: z.string().trim().min(1).max(200),
});
