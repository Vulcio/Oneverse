// Runs the end-to-end suites against an already-running API and web app
// (see e2e/README.md). `node e2e/run.mjs` runs everything; pass `api`,
// `web`, or suite names (`sets`, `web/sets`) to run a subset. `--shard 2/4`
// runs the second of four parts, as CI's parallel jobs do (issue #308):
// parts of about the same length, by each suite's last known duration
// (durations.json, from CI's summary; a suite not there counts as an
// average one). `--list` prints the suites instead of running them.
// `--durations` reads CI's summaries (`PASS  web/sets (42s)`, pasted from
// every part's log) on its input and keeps their durations in durations.json.
// `--changed <file>`: only the suites the paths listed in it need (issue
// #315, see affected.mjs), as pull requests run them; main runs every one.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { affected } from "./affected.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const all = ["api", "web"].flatMap((dir) =>
  readdirSync(path.join(root, dir))
    .filter((file) => file.endsWith(".test.mjs"))
    .sort()
    .map((file) => `${dir}/${file.replace(/\.test\.mjs$/, "")}`),
);
const args = process.argv.slice(2);
if (args.includes("--durations")) {
  const file = path.join(root, "durations.json");
  const durations = JSON.parse(readFileSync(file, "utf8"));
  let read = 0;
  // Only passed suites: a failed one's time is mostly its timeouts.
  for (const [, suite, seconds] of readFileSync(0, "utf8").matchAll(/^\s*PASS\s+(\S+)\s+\((\d+)s\)/gm)) {
    if (!all.includes(suite)) continue;
    durations[suite] = Number(seconds);
    read++;
  }
  // Suites that are gone, left out.
  const kept = Object.fromEntries(all.filter((suite) => suite in durations).map((suite) => [suite, durations[suite]]));
  writeFileSync(file, `{\n${Object.entries(kept).map(([suite, seconds]) => `${JSON.stringify(suite)}: ${seconds}`).join(",\n")}\n}\n`);
  console.log(`${read} durations read, ${all.length - Object.keys(kept).length} suites without one`);
  process.exit(0);
}
const shardAt = args.indexOf("--shard");
const shard = shardAt >= 0 ? /^(\d+)\/(\d+)$/.exec(args.splice(shardAt, 2)[1] ?? "") : null;
if (shardAt >= 0 && (!shard || Number(shard[1]) < 1 || Number(shard[1]) > Number(shard[2]))) {
  console.error("--shard takes a part and how many, like 2/4");
  process.exit(1);
}
const changedAt = args.indexOf("--changed");
const changedFile = changedAt >= 0 ? args.splice(changedAt, 2)[1] : null;
if (changedAt >= 0 && !changedFile) {
  console.error("--changed takes a file of changed paths, one a line");
  process.exit(1);
}
// `--list`: the suites it would run, without running them.
const listOnly = args.includes("--list");
const filters = args.filter((arg) => arg !== "--list");
const matching = filters.length === 0 ? all : all.filter((suite) => filters.some((f) => suite === f || suite.startsWith(`${f}/`) || suite.endsWith(`/${f}`)));
const needed = changedFile ? (affected(readFileSync(changedFile, "utf8").split("\n").map((line) => line.trim()).filter(Boolean), matching) ?? matching) : matching;
const suites = shard ? shardOf(needed, Number(shard[1]), Number(shard[2])) : needed;
if (changedFile && suites.length === 0) {
  console.log(needed.length === 0 ? "No suite needs this change." : "No suite in this part.");
  process.exit(0);
}
if (suites.length === 0) {
  console.error(`No suite matches ${filters.join(" ")}. Suites: ${all.join(", ")}`);
  process.exit(1);
}

if (listOnly) {
  console.log(suites.join("\n"));
  process.exit(0);
}

// A suite that fails runs once more (issue #515): a step that timed out on a
// busy runner mostly passes the second time, and that costs a minute rather
// than the whole run again. A suite that passes then is FLAKY in the summary
// and a warning on the run, so it can still be fixed; failing twice fails.
const summary = [];
for (const suite of suites) {
  const first = await runSuite(suite);
  if (first.ok) {
    summary.push({ suite, status: "PASS", seconds: first.seconds });
    continue;
  }
  const second = await runSuite(suite, true);
  if (second.ok) {
    summary.push({ suite, status: "FLAKY", seconds: first.seconds + second.seconds });
    annotate("warning", `e2e ${suite} flaky`, `Passed when run again. The first time:\n${first.failures.join("\n") || `exited with ${first.code}`}`);
  } else {
    summary.push({ suite, status: "FAIL", seconds: first.seconds + second.seconds });
    annotate("error", `e2e ${suite}`, second.failures.join("\n") || `exited with ${second.code}`);
  }
}

console.log("\n=== Summary ===");
// FLAKY isn't read by --durations: its time includes a failed run.
for (const { suite, status, seconds } of summary) console.log(`${status.padEnd(5)} ${suite} (${seconds}s)`);
const failed = summary.filter((s) => s.status === "FAIL").length;
const flaky = summary.filter((s) => s.status === "FLAKY").length;
console.log(`\n${summary.length - failed}/${summary.length} suites passed${flaky ? `, ${flaky} of them only when run again` : ""}`);
process.exitCode = failed > 0 ? 1 : 0;

/** Runs one suite, its output shown as it comes and its failed steps kept. */
async function runSuite(suite, again = false) {
  console.log(again ? `\n=== ${suite}, run again: it failed once ===` : `\n=== ${suite} ===`);
  const started = Date.now();
  const failures = [];
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, `${suite}.test.mjs`)], { stdio: ["inherit", "pipe", "inherit"] });
    let pending = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      failures.push(...lines.filter((line) => line.startsWith("FAIL")));
    });
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  return { ok: code === 0, code, failures, seconds: Math.round((Date.now() - started) / 1000) };
}

/** In CI, an annotation on the run: readable without the log. */
function annotate(level, title, text) {
  if (!process.env.GITHUB_ACTIONS) return;
  const one = (value) => value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").slice(0, 900);
  console.log(`::${level} title=${title}::${one(text)}`);
}

/** The `part`th of `count` parts of the suites, of about the same length: longest first, each to the shortest part so far. */
function shardOf(names, part, count) {
  let known = {};
  try {
    known = JSON.parse(readFileSync(path.join(root, "durations.json"), "utf8"));
  } catch {
    // None kept: every suite counts the same.
  }
  const values = Object.values(known);
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 1;
  // Without one, the parts drift apart and the slowest one holds up the run (issue #515).
  const unknown = names.filter((name) => !(name in known));
  if (unknown.length > 0 && part === 1) {
    annotate("warning", "e2e durations", `${unknown.length} suite(s) without a duration in e2e/durations.json, counted as ${Math.round(average)}s: ${unknown.join(", ")}. Refresh it from CI's summaries (e2e/README.md).`);
  }
  const parts = Array.from({ length: count }, () => ({ seconds: 0, suites: [] }));
  for (const name of [...names].sort((a, b) => (known[b] ?? average) - (known[a] ?? average) || a.localeCompare(b))) {
    const shortest = parts.reduce((min, one) => (one.seconds < min.seconds ? one : min));
    shortest.seconds += known[name] ?? average;
    shortest.suites.push(name);
  }
  return parts[part - 1].suites.sort();
}
