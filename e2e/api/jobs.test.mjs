// Background jobs (issue #92): the Worker runs them - the API only adds
// them - and says so with a heartbeat; Admin sees who runs them, each
// queue's counts and the last jobs, the backfills' results among them.
// Issue #93: a lookup that fails isn't "nothing found" - the song is tried
// again next time - and failed jobs are listed, with why, and cleared.
import { createRequire } from "node:module";
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { startFakeProviders } from "../lib/fake-providers.mjs";

// The API's Redis client, to leave failed jobs behind as a crash would.
const { Redis } = createRequire(new URL("../../apps/api/package.json", import.meta.url))("ioredis");
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

const fake = await startFakeProviders();
const admin = await user("Admin");
const someone = await user("Someone");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await api(admin, "DELETE", "/admin/artwork");

let status = await api(admin, "GET", "/admin/jobs");
check("the Worker is running: its heartbeat under a minute old", !!status.worker && Date.now() - Date.parse(status.worker.at) < 60000, JSON.stringify(status.worker));
check("this API doesn't run jobs itself (JOBS_IN_API=false, as in production)", status.thisApiRunsJobs === false && status.api === null, JSON.stringify(status));
check("the queues", status.queues.map((q) => q.name).join() === "lookups,backfills,bulk-upload,user-maintenance,recordings,stem-separation,team-events,notifications,scriptures,live-sessions,backups,archives,own-storage,song-info", JSON.stringify(status.queues));
// Recorded takes are turned into Opus with it (issue #127).
check("the Worker has ffmpeg, and says which", /^\d/.test(status.worker?.ffmpeg ?? ""), JSON.stringify(status.worker));
check("admins only", (await call(someone, "GET", "/admin/jobs")).status === 403);

// The Worker's SETTINGS_ENCRYPTION_KEY against the API's (issue #95): only the verdict, never a hash of it.
check("the Worker has the API's settings key", status.worker?.settingsKey === "same", JSON.stringify(status.worker));
const realBeat = await redis.get("songverse:jobs:worker");
const fakeBeat = async (settingsKey) => {
  await redis.set("songverse:jobs:worker", JSON.stringify({ ...JSON.parse(realBeat), settingsKey }), "EX", 60);
  return (await api(admin, "GET", "/admin/jobs")).worker;
};
check("a Worker without one: said so", (await fakeBeat(null))?.settingsKey === "missing");
const different = await fakeBeat("0123456789ab");
check("one with another: said so, without its hash", different?.settingsKey === "different" && !JSON.stringify(different).includes("0123456789ab"), JSON.stringify(different));
await redis.set("songverse:jobs:worker", realBeat, "EX", 60);

// A new song's artwork: a job, run by the Worker.
const song = await api(someone, "POST", "/song-versions", { title: `Queued ${stamp}`, language: "en", artists: ["Queue"] });
let imageUrl = null;
for (let i = 0; i < 60 && !imageUrl; i++) {
  imageUrl = (await api(someone, "GET", `/song-versions/${song.id}`)).imageUrl;
  if (!imageUrl) await new Promise((resolve) => setTimeout(resolve, 250));
}
check("a new song's artwork, found by the Worker", !!imageUrl);

// A backfill: started, then its result among the recent jobs.
const r = await call(admin, "POST", "/admin/artwork/backfill");
check("a backfill starts", r.status === 201 && r.body.queued === true, JSON.stringify(r.body));
let done = null;
for (let i = 0; i < 180 && !done; i++) {
  status = await api(admin, "GET", "/admin/jobs");
  done = status.recent.find((job) => job.queue === "backfills" && job.id === r.body.jobId);
  if (!done) await new Promise((resolve) => setTimeout(resolve, 500));
}
check("its result among the recent jobs", done?.state === "completed" && typeof done.result?.tried === "number" && typeof done.result?.found === "number", JSON.stringify(done));
check("the artwork job there too", status.recent.some((job) => job.name === "artwork" && job.queue === "lookups"));

// --- a failed lookup isn't "nothing found" (issue #93)
await api(admin, "DELETE", "/admin/metadata");
const down = await api(someone, "POST", "/song-versions", { title: `Itunesdown Deezerdown ${stamp}`, language: "en", artists: ["Queue"] });
const nothing = await api(someone, "POST", "/song-versions", { title: `Nomatch ${stamp}`, language: "en", artists: ["Queue"] });
const marked = (id) => sql(`select coalesce("imageSourceUrl", '') from "SongVersion" where id='${id}'`);
const backfill = async () => {
  const { jobId } = (await call(admin, "POST", "/admin/artwork/backfill")).body;
  for (let i = 0; i < 240; i++) {
    const job = (await api(admin, "GET", "/admin/jobs")).recent.find((j) => j.queue === "backfills" && j.id === jobId);
    if (job) return job.result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
};
let result = await backfill();
check("the backfill counts the songs whose lookup failed", result?.failed >= 1, JSON.stringify(result));
check("a song whose lookup failed is tried again next time", marked(down.id) === "");
check("one with nothing close enough isn't", marked(nothing.id) === "none");
result = await backfill();
check("next time, it's tried again", result?.failed >= 1 && marked(down.id) === "", JSON.stringify(result));

// --- failed jobs, listed with why; those whose details are gone counted; cleared
const now = Date.now();
await redis.hset(`bull:lookups:failed-${stamp}`, { name: "artwork", data: JSON.stringify({ songVersionId: "gone" }), opts: "{}", timestamp: String(now), finishedOn: String(now), processedOn: String(now), failedReason: `Boom ${stamp}`, attemptsMade: "1" });
await redis.zadd("bull:lookups:failed", now, `failed-${stamp}`);
await redis.zadd("bull:user-maintenance:failed", now, `orphan-${stamp}`);
status = await api(admin, "GET", "/admin/jobs");
check("a failed job listed, with why", status.failed.some((job) => job.error === `Boom ${stamp}` && job.name === "artwork" && job.queue === "lookups"), JSON.stringify(status.failed));
check("one whose details are gone, counted", status.failedWithoutDetails >= 1, String(status.failedWithoutDetails));
check("only admins clear them", (await call(someone, "DELETE", "/admin/jobs/failed")).status === 403);
const cleared = await api(admin, "DELETE", "/admin/jobs/failed");
status = await api(admin, "GET", "/admin/jobs");
check("cleared, both", cleared.cleared >= 2 && status.failed.length === 0 && status.failedWithoutDetails === 0 && status.queues.every((q) => q.failed === 0), JSON.stringify({ cleared, failed: status.failed, n: status.failedWithoutDetails }));

redis.disconnect();
fake.close();
finish();
