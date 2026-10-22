import { createHash } from "node:crypto";

/**
 * Background jobs (issue #92). Every processor is created stopped
 * (`autorun: false`) and started by `startJobs()` in the process that runs
 * them: the Worker always; the API only with JOBS_IN_API (by default, out
 * of production - `pnpm dev` without a Worker).
 */
export const JOB_WORKER_OPTIONS = { autorun: false } as const;

export const LOOKUPS_QUEUE = "lookups";
/** Recorded takes turned into Opus (issue #127). */
export const RECORDINGS_QUEUE = "recordings";
/** Recordings split into stems at our Demucs API (issue #63). */
export const STEM_SEPARATION_QUEUE = "stem-separation";
/** Teams' event dates given their sets ahead of time (issue #235). */
export const TEAM_EVENTS_QUEUE = "team-events";
/** Notifications sent by email (issue #236), and later by push. */
export const NOTIFICATIONS_QUEUE = "notifications";
/** Live sessions nobody changed for a while, ended (issue #247). */
export const LIVE_SESSIONS_QUEUE = "live-sessions";

/**
 * A short hash of this process's SETTINGS_ENCRYPTION_KEY, or null without
 * one (issue #95): in its heartbeat, so Admin can tell a Worker that can't
 * decrypt the saved secrets. Never the key itself.
 */
export function settingsKeyCheck(): string | null {
  const key = process.env.SETTINGS_ENCRYPTION_KEY;
  return key ? createHash("sha256").update(`songverse-settings-key-check\n${key}`).digest("hex").slice(0, 12) : null;
}
/** The admin's backfills, on their own queue (issue #93): a new song's lookups never wait behind one. */
export const BACKFILLS_QUEUE = "backfills";

/** Whether this API process runs jobs itself: JOBS_IN_API, else only out of production. */
export function jobsInApi(): boolean {
  const said = process.env.JOBS_IN_API?.trim().toLowerCase();
  if (said) return ["true", "1", "yes", "on"].includes(said);
  return process.env.NODE_ENV !== "production";
}

/** Where a process that runs jobs says it's alive, refreshed every 15 seconds, gone after a minute. */
export const HEARTBEAT_KEY = (role: "worker" | "api") => `songverse:jobs:${role}`;
