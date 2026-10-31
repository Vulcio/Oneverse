// The API at library scale (issue #341): makes a catalogue of SONGS songs
// (50,000 by default) by copying a few hundred real ones in the database,
// a team with members, sets and a songbook, then times the pages people
// open most - how long, how many database queries and how much database
// time each takes. Run against a local stack with pg_stat_statements
// (shared_preload_libraries), not in CI: it fills the database.
//
//   node perf/bench.mjs              # seed if needed, then measure
//   SONGS=5000 node perf/bench.mjs   # a smaller library
//   BUDGET=1 node perf/bench.mjs     # fail when a page is over its budget
import { execSync } from "node:child_process";
import { API, api, call, sql, user } from "../lib/harness.mjs";

const SONGS = Number(process.env.SONGS ?? 50_000);
const BASE = 300;
const RUNS = 15;
const DB = process.env.DATABASE_URL?.replace(/\?.*$/, "") ?? "postgresql://postgres:postgres@localhost:5432/songverse_e2e";
const psql = (query) => execSync(`psql ${DB} -v ON_ERROR_STOP=1 -qtA`, { input: query }).toString().trim();

const chart = (i) => `{start_of_verse: Verse 1}
[G]Amazing grace how [C]sweet the sound ${i}
That [G]saved a wretch like [D]me
{end_of_verse}
{start_of_chorus}
[C]My chains are [G]gone, I've been set [D]free ${i}
[C]My God, my [G]Saviour has [Em]ransomed [D]me
{end_of_chorus}
{start_of_verse: Verse 2}
[G]'Twas grace that taught my [C]heart to fear
And [G]grace my fears re[D]lieved
{end_of_verse}
{chorus}
`;

// --- the library: BASE songs made through the API, half the team's, then copied as catalogue songs.
const owner = await user("Bench owner");
const members = [];
for (let i = 0; i < 4; i++) members.push(await user(`Bench member ${i}`));
const team = await api(owner, "POST", "/teams", { name: `Bench team ${Date.now()}` });
for (const member of members) sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tm${member.id}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const songs = [];
for (let i = 0; i < BASE; i++) {
  const song = await api(owner, "POST", "/song-versions", { title: `Bench song ${i} grace`, artists: [`Bench artist ${i % 40}`], language: "en", content: chart(i), contentFormat: "CHORDPRO", ...(i % 2 ? { teamId: team.id } : {}) });
  songs.push(song.id);
}
const have = Number(psql(`select count(*) from "SongVersion" where "ownerScope"='GLOBAL'`));
const copies = Math.ceil(Math.max(0, SONGS - have) / BASE);
if (copies > 0) {
  const columns = (table, skip) => psql(`select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_name='${table}' and column_name not in (${skip.map((name) => `'${name}'`).join(",")}) and is_generated='NEVER'`);
  const songColumns = columns("SongVersion", ["id", "workId", "title", "ownerScope", "ownerUserId", "ownerTeamId", "publicationState"]);
  const creditColumns = columns("VersionContributor", ["id", "songVersionId"]);
  const from = (prefix, list) => list.split(",").map((column) => `${prefix}.${column}`).join(",");
  const ids = songs.map((id) => `'${id}'`).join(",");
  psql(`BEGIN;
CREATE TEMP TABLE copy AS SELECT s.id AS old, 'b' || n || '_' || s.id AS new, 'bw' || n || '_' || s.id AS work, n FROM "SongVersion" s, generate_series(1, ${copies}) n WHERE s.id IN (${ids});
INSERT INTO "Work" (id, "createdAt", "updatedAt") SELECT work, now(), now() FROM copy;
INSERT INTO "SongVersion" (id, "workId", title, "ownerScope", "publicationState", ${songColumns}) SELECT copy.new, copy.work, replace(s.title, 'Bench song', 'Bench song v' || copy.n), 'GLOBAL', 'APPROVED', ${from("s", songColumns)} FROM copy JOIN "SongVersion" s ON s.id = copy.old;
INSERT INTO "VersionContributor" (id, "songVersionId", ${creditColumns}) SELECT 'bc' || copy.new || c.id, copy.new, ${from("c", creditColumns)} FROM copy JOIN "VersionContributor" c ON c."songVersionId" = copy.old;
COMMIT;
ANALYZE "SongVersion"; ANALYZE "VersionContributor";`);
}
console.log(`${psql(`select count(*) from "SongVersion"`)} songs`);

// --- sets and a songbook: 8 songs a set, as a team plans them.
const sets = [];
for (let i = 0; i < 6; i++) {
  const set = await api(owner, "POST", "/setlists", { name: `Bench set ${i}`, teamId: team.id });
  for (const id of songs.filter((_, n) => n % 2).slice(i * 8, i * 8 + 8)) await api(owner, "POST", `/setlists/${set.id}/items`, { songVersionId: id });
  sets.push(set.id);
}
const book = await api(owner, "POST", "/songbooks", { name: "Bench book", kind: "SIMPLE", teamId: team.id });
for (const id of songs.filter((_, n) => n % 2).slice(0, 100)) await api(owner, "POST", `/songbooks/${book.id}/entries`, { songVersionId: id });

const member = members[0];
const set = sets[0];
const item = (await call(member, "GET", `/setlists/${set}`)).body.items[0].id;
const song = songs[1];
// Each page, and the most it should take (ms, median) at 50,000 songs on a laptop: above it, something got slower.
const pages = [
  ["library list", "/song-versions?pageSize=50", 60],
  ["library list, page 40", "/song-versions?pageSize=50&page=40", 80],
  ["library sorted by title", "/song-versions?pageSize=50&sort=title", 60],
  ["library search", "/song-versions?q=grace&pageSize=50", 150],
  ["library search in the words", "/song-versions?q=chains%20are&in=lyrics&pageSize=50", 200],
  ["library stats", "/song-versions/stats", 200],
  ["artists", "/song-versions/artists", 250],
  ["library home", "/library/home", 100],
  ["song page", `/song-versions/${song}`, 40],
  ["song's neighbours", `/song-versions/${song}/neighbors`, 80],
  ["sets", "/setlists", 40],
  ["set page", `/setlists/${set}`, 60],
  ["set's song", `/setlists/${set}/items/${item}/song`, 50],
  ["set kept offline", `/setlists/${set}/offline`, 250],
  ["songbook", `/songbooks/${book.id}`, 80],
];
const hasStats = (() => {
  try {
    psql("select pg_stat_statements_reset()");
    return true;
  } catch {
    console.log("(no pg_stat_statements: queries not counted)");
    return false;
  }
})();
const rows = [];
for (const [name, path, budget] of pages) {
  const first = await call(member, "GET", path);
  if (hasStats) psql("select pg_stat_statements_reset()");
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${member.bearer}` } })).text();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const [queries, dbMs] = hasStats ? psql(`select coalesce(sum(calls), 0), coalesce(sum(total_exec_time), 0) from pg_stat_statements where query not like '%pg_stat_statements%'`).split("|").map(Number) : [NaN, NaN];
  rows.push({ page: name, status: first.status, "p50 ms": Math.round(times[RUNS >> 1]), "p90 ms": Math.round(times[Math.floor(RUNS * 0.9)]), queries: +(queries / RUNS).toFixed(1), "db ms": +(dbMs / RUNS).toFixed(1), budget });
}
console.table(rows);
const over = rows.filter((row) => row.status !== 200 || row["p50 ms"] > row.budget);
if (over.length) console.log(`Over budget: ${over.map((row) => row.page).join(", ")}`);
if (process.env.BUDGET && over.length) process.exit(1);
