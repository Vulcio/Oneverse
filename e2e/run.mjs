// Runs the end-to-end suites against an already-running API and web app
// (see e2e/README.md). `node e2e/run.mjs` runs everything; pass `api`,
// `web`, or suite names (`sets`, `web/sets`) to run a subset. `--shard 2/4`
// runs the second of four parts, as CI's parallel jobs do (issue #308):
// parts of about the same length, by each suite's last known duration
// (durations.json, from CI's summary; a suite not there counts as an
// average one). `--list` prints the suites instead of running them.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const all = ["api", "web"].flatMap((dir) =>
  readdirSync(path.join(root, dir))
    .filter((file) => file.endsWith(".test.mjs"))
    .sort()
    .map((file) => `${dir}/${file.replace(/\.test\.mjs$/, "")}`),
);
const args = process.argv.slice(2);
const shardAt = args.indexOf("--shard");
const shard = shardAt >= 0 ? /^(\d+)\/(\d+)$/.exec(args.splice(shardAt, 2)[1] ?? "") : null;
if (shardAt >= 0 && (!shard || Number(shard[1]) < 1 || Number(shard[1]) > Number(shard[2]))) {
  console.error("--shard takes a part and how many, like 2/4");
  process.exit(1);
}
// `--list`: the suites it would run, without running them.
const listOnly = args.includes("--list");
const filters = args.filter((arg) => arg !== "--list");
const matching = filters.length === 0 ? all : all.filter((suite) => filters.some((f) => suite === f || suite.startsWith(`${f}/`) || suite.endsWith(`/${f}`)));
const suites = shard ? shardOf(matching, Number(shard[1]), Number(shard[2])) : matching;
if (suites.length === 0) {
  console.error(`No suite matches ${filters.join(" ")}. Suites: ${all.join(", ")}`);
  process.exit(1);
}

if (listOnly) {
  console.log(suites.join("\n"));
  process.exit(0);
}

const summary = [];
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const started = Date.now();
  const failures = [];
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, `${suite}.test.mjs`)], { stdio: ["inherit", "pipe", "inherit"] });
    // Shown as it comes, and its failed steps kept for the summary.
    let pending = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      failures.push(...lines.filter((line) => line.startsWith("FAIL")));
    });
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  summary.push({ suite, ok: code === 0, seconds: Math.round((Date.now() - started) / 1000) });
  // In CI, each failure is an annotation on the run: readable without the log.
  if (code !== 0 && process.env.GITHUB_ACTIONS) {
    const one = (text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").slice(0, 900);
    console.log(`::error title=e2e ${suite}::${one(failures.join("\n") || `exited with ${code}`)}`);
  }
}

console.log("\n=== Summary ===");
for (const { suite, ok, seconds } of summary) console.log(`${ok ? "PASS" : "FAIL"}  ${suite} (${seconds}s)`);
const failed = summary.filter((s) => !s.ok).length;
console.log(`\n${summary.length - failed}/${summary.length} suites passed`);
process.exitCode = failed > 0 ? 1 : 0;

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
  const parts = Array.from({ length: count }, () => ({ seconds: 0, suites: [] }));
  for (const name of [...names].sort((a, b) => (known[b] ?? average) - (known[a] ?? average) || a.localeCompare(b))) {
    const shortest = parts.reduce((min, one) => (one.seconds < min.seconds ? one : min));
    shortest.seconds += known[name] ?? average;
    shortest.suites.push(name);
  }
  return parts[part - 1].suites.sort();
}
