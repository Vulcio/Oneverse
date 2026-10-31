// Server backups (issue #119): Admin > Backups' settings, "Back up now" run
// by the Worker - the database dumped and encrypted with
// SETTINGS_ENCRYPTION_KEY, the stored files copied once to a second bucket -
// and the restore command putting both back into an empty database and storage.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API, DB, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { startFakeS3 } from "../lib/fake-s3.mjs";

const s3 = await startFakeS3();
const admin = await user("Backup admin");
const someone = await user("Someone");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);

// A song with a file, to find in the backup and in the restore.
const song = await api(admin, "POST", "/song-versions", { title: `Backed up ${stamp}`, language: "en", artists: ["Keeper"], content: "[G]Kept\n", contentFormat: "CHORDPRO" });
const pdf = Buffer.from(`%PDF-1.4\nbackup ${stamp}\n${"x".repeat(3000)}`);
const form = new FormData();
form.append("type", "PDF");
form.append("file", new Blob([pdf], { type: "application/pdf" }), "Sheet.pdf");
await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${admin.bearer}` }, body: form });
const hash = createHash("sha256").update(pdf).digest("hex");
check("the file is stored under its hash", sql(`select count(*) from "Attachment" where "storageKey"='${hash}'`) === "1");

check("admins only", (await call(someone, "GET", "/admin/backups")).status === 403 && (await call(someone, "POST", "/admin/backups/run")).status === 403);

const bucket = "backups";
const prefix = `e2e-${stamp}`;
let r = await call(admin, "PUT", "/admin/backups/config", { endpoint: s3.url, bucket, prefix, accessKeyId: "e2e-key", secretAccessKey: "e2e-secret-not-real", keepDaily: 3 });
check("the destination is saved", r.status === 204, JSON.stringify(r.body));
r = await call(admin, "PUT", "/admin/backups/config", { hourUtc: 24 });
check("an hour outside the day is refused, by name", r.status === 400 && r.body.message.some((m) => m.includes("hourUtc")), JSON.stringify(r.body));
let summary = await api(admin, "GET", "/admin/backups");
check(
  "Admin sees it from the database, the secret only as there being one",
  summary.destination.kind === "s3" && summary.destination.source === "database" && summary.saved.hasDatabaseSecret === true && !JSON.stringify(summary).includes("e2e-secret-not-real"),
  JSON.stringify(summary.destination),
);
check("on once there's a destination; 7/4/12 by default, the saved one from the database", summary.settings.enabled.value === true && summary.settings.keepDaily.value === 3 && summary.settings.keepDaily.source === "database" && summary.settings.keepWeekly.value === 4 && summary.settings.keepMonthly.value === 12, JSON.stringify(summary.settings));

const backUp = async () => {
  const before = new Set((await api(admin, "GET", "/admin/backups")).runs.map((run) => run.id));
  const queued = await call(admin, "POST", "/admin/backups/run");
  if (queued.status !== 202) return { queued };
  for (let i = 0; i < 240; i++) {
    const run = (await api(admin, "GET", "/admin/backups")).runs.find((item) => !before.has(item.id) && item.status !== "running");
    if (run) return { queued, run };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { queued };
};

const first = await backUp();
check("Back up now: queued for the Worker, then done", first.queued.status === 202 && first.run?.status === "ok", JSON.stringify(first.run ?? first.queued.body));
check("the run says what it copied", first.run?.trigger === "manual" && first.run.databaseBytes > 0 && first.run.filesCopied >= 1 && first.run.filesMissing === 0, JSON.stringify(first.run));
const dumps = s3.keys(bucket, `${prefix}/db/`);
check("one database dump, named by its time, under the prefix", dumps.length === 1 && /\/db\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.dump\.enc$/.test(dumps[0]), dumps.join());
const dump = s3.get(bucket, dumps[0]);
check("the dump is encrypted (not a readable pg_dump file)", dump.subarray(0, 8).toString() === "Salted__" && !dump.includes(Buffer.from("PGDMP")) && !dump.includes(Buffer.from(`Backed up ${stamp}`)));
check("the file is copied, under its hash, byte for byte", Buffer.compare(s3.get(bucket, `${prefix}/files/${hash}`) ?? Buffer.alloc(0), pdf) === 0);
const latest = JSON.parse(s3.get(bucket, `${prefix}/latest.json`)?.toString() ?? "{}");
check("latest.json says which dump, version and migration", latest.database === dumps[0].slice(prefix.length + 1) && /^\d+\.\d+\.\d+/.test(latest.version) && /^\d+_/.test(latest.migration ?? ""), JSON.stringify(latest));

// Dumps a second apart, so the second gets its own name.
await new Promise((resolve) => setTimeout(resolve, 1100));
const second = await backUp();
check("the second backup copies no file twice", second.run?.status === "ok" && second.run.filesCopied === 0 && second.run.filesKept >= 1, JSON.stringify(second.run));
const kept = s3.keys(bucket, `${prefix}/db/`).sort();
// Both made the same day: only the day's newest stays (unless midnight came between them).
check("the dumps rotate: the day's newest is kept, the older one removed", kept.at(-1) !== dumps[0] && (kept.length === 1 ? second.run.dumpsRemoved === 1 : kept[0].slice(-29, -19) !== kept[1].slice(-29, -19)), `${kept.join()} ${JSON.stringify(second.run)}`);

// Restore: into an empty database, the files into an empty storage (a folder here).
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/api");
const scratch = `restore_${stamp}`;
sql(`create database ${scratch}`);
const scratchUrl = DB.replace(/\/[^/]+$/, `/${scratch}`);
const storageDir = mkdtempSync(path.join(tmpdir(), "restore-files-"));
const backupEnv = { BACKUP_S3_ENDPOINT: s3.url, BACKUP_S3_BUCKET: bucket, BACKUP_S3_PREFIX: prefix, BACKUP_S3_ACCESS_KEY_ID: "x", BACKUP_S3_SECRET_ACCESS_KEY: "y", R2_ACCOUNT_ID: "", R2_BUCKET: "" };
// Not spawnSync: the stand-in bucket answers from this process.
const restoreWith = (env, ...args) =>
  new Promise((resolve) => {
    const child = spawn("node", [path.join(apiDir, "dist/backups/restore.js"), ...args], { cwd: storageDir, env: { ...process.env, ...backupEnv, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
const restore = (...args) => restoreWith({}, ...args);
try {
  const listed = await restore("--list");
  check("the restore command lists the dumps", listed.status === 0 && listed.stdout.includes(".dump.enc"), listed.stderr || listed.stdout);
  const refused = await restore("--database-url", `${DB}?schema=public`, "--skip-files");
  check("it refuses a database that isn't empty", refused.status !== 0 && /already has \d+ table/.test(refused.stderr), refused.stderr);
  const wrongKey = await restoreWith({ SETTINGS_ENCRYPTION_KEY: "not-the-key" }, "--database-url", scratchUrl, "--skip-files");
  check("without the server's SETTINGS_ENCRYPTION_KEY the dump can't be opened", wrongKey.status !== 0 && /SETTINGS_ENCRYPTION_KEY/.test(wrongKey.stderr), wrongKey.stderr);
  const restored = await restore("--database-url", scratchUrl);
  check("the restore runs", restored.status === 0, `${restored.stdout}\n${restored.stderr}`);
  const inScratch = (q) => spawnSync("psql", [scratchUrl, "-tAc", q], { encoding: "utf8" }).stdout.trim();
  check("the song is in the restored database, with its file", inScratch(`select title from "SongVersion" where id='${song.id}'`) === `Backed up ${stamp}` && inScratch(`select count(*) from "Attachment" where "storageKey"='${hash}'`) === "1");
  check("the admin's backup settings came back too", inScratch(`select bucket from "BackupSettings"`) === bucket);
  const file = path.join(storageDir, ".data", "attachments", hash);
  check("the file is back in the storage, byte for byte", existsSync(file) && Buffer.compare(readFileSync(file), pdf) === 0);
  check("it said what it put back", /Files: \d+ put back/.test(restored.stdout), restored.stdout);
} finally {
  sql(`drop database if exists ${scratch}`);
  rmSync(storageDir, { recursive: true, force: true });
}

// Back to the environment: no destination in CI, so off.
r = await call(admin, "DELETE", "/admin/backups/config");
summary = await api(admin, "GET", "/admin/backups");
check("Revert to environment variables: no destination, off", r.status === 204 && summary.destination.kind === "none" && summary.settings.enabled.value === false, JSON.stringify(summary.destination));
check("the runs stay listed", summary.runs.length >= 2);

const health = await (await fetch(`${API}/health`)).json();
check("/health says the version and the latest migration (issue #164)", health.status === "ok" && /^\d+\.\d+\.\d+/.test(health.version) && /^\d+_/.test(health.migration ?? ""), JSON.stringify(health));

await s3.close();
finish();
