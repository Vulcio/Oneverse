import "../zod-config.js";
import { z } from "zod";

/** YouVersion's App Key (issue #304); empty clears the saved one. */
export const YouVersionKeySchema = z.strictObject({
  appKey: z.string().trim().max(200),
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
