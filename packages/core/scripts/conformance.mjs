// Writes the shared test cases (issue #170) to conformance/*.json, their
// answers this implementation's: `pnpm --filter @oneverse/core conformance`
// after changing a case, or a behaviour on purpose - then review the diff.
// `--check` only says whether the files are up to date (as the unit tests do).
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { conformanceFiles } from "../dist/conformance/index.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../conformance");
const check = process.argv.includes("--check");
const files = conformanceFiles();
const stale = [];
for (const [name, file] of Object.entries(files)) {
  const text = `${JSON.stringify(file, null, 2)}\n`;
  let current = null;
  try {
    current = readFileSync(path.join(dir, name), "utf8");
  } catch {}
  if (current === text) continue;
  stale.push(name);
  if (!check) writeFileSync(path.join(dir, name), text);
}
for (const name of readdirSync(dir).filter((name) => name.endsWith(".json") && !(name in files))) {
  stale.push(`${name} (no longer an area)`);
  if (!check) rmSync(path.join(dir, name));
}
if (check && stale.length) {
  console.error(`Out of date: ${stale.join(", ")}. Run pnpm --filter @oneverse/core conformance and review the diff.`);
  process.exit(1);
}
const cases = Object.values(files).reduce((n, file) => n + Object.values(file.functions).reduce((m, fn) => m + fn.cases.length, 0), 0);
console.log(`${check ? "Up to date" : stale.length ? `Wrote ${stale.join(", ")}` : "Nothing changed"}: ${Object.keys(files).length} areas, ${cases} cases.`);
