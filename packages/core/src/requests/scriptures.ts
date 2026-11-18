import "../zod-config.js";
import { z } from "zod";
import { clearableText, optional } from "./fields.js";

/**
 * YouVersion's settings (issues #304, #485), each left out kept: the App Key
 * (empty clears the saved one), and whether passages are kept as long as
 * YouVersion's Cache-Control allows - null back to YOUVERSION_CACHE (else yes).
 */
export const YouVersionKeySchema = z.strictObject({
  appKey: optional(z.string().trim().max(200)),
  cache: z.boolean().nullable().optional(),
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

/** What YouVersion's search looks for (issue #507): words in verses, a theme, a reference, or it works it out (unknown). */
export const YOUVERSION_SEARCH_INTENTS = ["unknown", "text", "topical", "reference"] as const;

/**
 * A search in a YouVersion version (issue #507): the words (1-100
 * characters, as YouVersion takes), the language topics are named in, and
 * what is looked for; `page`: the next page of verses a search gave.
 */
export const YouVersionSearchQuerySchema = z.strictObject({
  query: z.string().trim().min(1).max(100),
  language: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/, "language must be a language tag, like en or fr"),
  intent: optional(z.enum(YOUVERSION_SEARCH_INTENTS)),
  page: optional(z.string().trim().min(1).max(1000)),
});
