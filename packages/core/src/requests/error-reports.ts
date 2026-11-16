import "../zod-config.js";
import { z } from "zod";

/**
 * POST /error-reports (issue #469): an error a web app ran into, for the API
 * to report - scrubbed, with its own DSN - when Admin > Error reporting has
 * browsers' errors on. Only what's needed to find the bug: no user, no page's
 * content, the page's path without its query.
 */
export const ErrorReportSchema = z.strictObject({
  app: z.enum(["web", "planiverse", "oneverse", "screen"]).describe("The web app it happened in"),
  type: z.string().trim().min(1).max(200).describe("The error's kind: TypeError, ChunkLoadError…"),
  message: z.string().max(2000).describe("The error's message"),
  stack: z.string().max(20_000).optional().describe("Its stack, as the browser wrote it"),
  path: z.string().max(500).optional().describe("The page's path, without its query"),
  release: z.string().max(64).optional().describe("The app's version, as its page has it"),
});
export type ErrorReportRequest = z.input<typeof ErrorReportSchema>;

/**
 * PUT /admin/error-reporting (issue #469): left out keeps its value; null (or
 * an empty DSN) goes back to the env vars (ERROR_REPORTING_DSN,
 * ERROR_REPORTING_BROWSERS, ERROR_REPORTING_ENVIRONMENT), else off.
 */
export const SaveErrorReportingSettingsSchema = z.strictObject({
  dsn: z
    .string()
    .trim()
    .max(500)
    .refine((dsn) => dsn === "" || /^https?:\/\/[^@/\s]+@[^/\s]+\/(?:[^\s?#]*\/)?[\w-]+$/.test(dsn), "dsn must be a DSN: https://key@host/project")
    .nullable()
    .optional()
    .describe("Where reports go: the DSN of a Sentry or GlitchTip project"),
  browsers: z.boolean().nullable().optional().describe("The web apps' errors reported too"),
  environment: z.string().trim().max(64).nullable().optional().describe("The environment reports are filed under: production, staging…"),
});
export type SaveErrorReportingSettingsRequest = z.input<typeof SaveErrorReportingSettingsSchema>;
