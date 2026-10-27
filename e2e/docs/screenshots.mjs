// Takes the screenshots in apps/docs/src/assets/screenshots/ (issue #4), on a
// fresh copy of the app so nothing but the demo content shows: a new
// database, production builds of the API and web app on their own ports,
// then capture.mjs signs up a demo user and photographs each page in every
// language the docs have.
//
//   node e2e/docs/screenshots.mjs              # build, then capture
//   node e2e/docs/screenshots.mjs --no-build   # reuse the last build
//
// Needs Postgres and Redis running, like the e2e suites (see e2e/README.md).
// The database it creates, songverse_docs, is dropped and made again each run.
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PG = process.env.DOCS_PG_URL ?? "postgresql://postgres:postgres@localhost:5432";
const DATABASE_URL = `${PG}/songverse_docs?schema=public`;
const API_PORT = 3101;
const WEB_PORT = 3100;
const PLANIVERSE_PORT = 3102;
const ONEVERSE_PORT = 3103;
const SCREEN_PORT = 3104;
const API_LOG = "/tmp/docs-api.log";
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

console.log("Fresh database songverse_docs");
run(`psql ${PG}/postgres -c "drop database if exists songverse_docs" -c "create database songverse_docs"`);
run("pnpm --filter @oneverse/db exec prisma migrate deploy", { DATABASE_URL });
if (!process.argv.includes("--no-build")) run("pnpm vp run --filter @oneverse/api --filter @oneverse/web --filter @oneverse/planiverse --filter @oneverse/oneverse --filter @oneverse/screen-app build");
run("pnpm --filter @oneverse/db seed", { DATABASE_URL });

const env = {
  ...process.env,
  DATABASE_URL,
  AUTH_URL: `http://localhost:${API_PORT}`,
  WEB_URL: `http://localhost:${WEB_PORT}`,
  API_URL: `http://localhost:${API_PORT}`,
  // Planiverse (issue #241) beside it, opening sets in Songverse.
  PLANIVERSE_URL: `http://localhost:${PLANIVERSE_PORT}`,
  SONGVERSE_URL: `http://localhost:${WEB_PORT}`,
  // Oneverse (issue #303): where people sign in, the apps its OAuth clients.
  ONEVERSE_URL: `http://localhost:${ONEVERSE_PORT}`,
  // The screen app (issue #305): what big screens open.
  SCREEN_URL: `http://localhost:${SCREEN_PORT}`,
  // A Redis database of its own, the API running the jobs (issue #92): none of
  // another Worker's, on another database, pick them up.
  REDIS_URL: process.env.DOCS_REDIS_URL ?? "redis://localhost:6379/15",
  JOBS_IN_API: "true",
};
const servers = [
  spawn("sh", ["-c", `node dist/main.js > ${API_LOG} 2>&1`], { cwd: path.join(root, "apps/api"), env: { ...env, PORT: String(API_PORT) }, detached: true }),
  spawn("sh", ["-c", "node server.mjs > /tmp/docs-web.log 2>&1"], { cwd: path.join(root, "apps/web"), env: { ...env, PORT: String(WEB_PORT) }, detached: true }),
  spawn("sh", ["-c", "node server.mjs > /tmp/docs-planiverse.log 2>&1"], { cwd: path.join(root, "apps/planiverse"), env: { ...env, PORT: String(PLANIVERSE_PORT) }, detached: true }),
  spawn("sh", ["-c", "node server.mjs > /tmp/docs-oneverse.log 2>&1"], { cwd: path.join(root, "apps/oneverse"), env: { ...env, PORT: String(ONEVERSE_PORT) }, detached: true }),
  spawn("sh", ["-c", "node server.mjs > /tmp/docs-screen.log 2>&1"], { cwd: path.join(root, "apps/screen"), env: { ...env, PORT: String(SCREEN_PORT) }, detached: true }),
];
const stop = () => servers.forEach((server) => { try { process.kill(-server.pid); } catch {} });
process.on("exit", stop);

try {
  for (let i = 0; ; i++) {
    const up = await Promise.all([`http://localhost:${API_PORT}/health`, `http://localhost:${WEB_PORT}/`, `http://localhost:${PLANIVERSE_PORT}/`, `http://localhost:${ONEVERSE_PORT}/sign-in`, `http://localhost:${SCREEN_PORT}/`].map((url) => fetch(url).then((r) => r.ok, () => false)));
    if (up.every(Boolean)) break;
    if (i > 60) throw new Error(`The API or a web app didn't start: see ${API_LOG}, /tmp/docs-web.log, /tmp/docs-planiverse.log, /tmp/docs-oneverse.log and /tmp/docs-screen.log`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  run("node e2e/docs/capture.mjs", {
    E2E_API_URL: `http://localhost:${API_PORT}`,
    E2E_WEB_URL: `http://localhost:${WEB_PORT}`,
    E2E_PLANIVERSE_URL: `http://localhost:${PLANIVERSE_PORT}`,
    E2E_ONEVERSE_URL: `http://localhost:${ONEVERSE_PORT}`,
    E2E_SCREEN_URL: `http://localhost:${SCREEN_PORT}`,
    E2E_API_LOG: API_LOG,
    E2E_DATABASE_URL: `${PG}/songverse_docs`,
  });
} finally {
  stop();
}
