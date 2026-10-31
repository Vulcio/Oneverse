#!/usr/bin/env node
// Drafts a release's notes (issue #164): the issues closed as done since the
// previous release's tag, a breaking change first, then by area. Run by
// .github/workflows/release.yml, or by hand to read a draft before tagging:
//
//   node scripts/release-notes.mjs v0.9.0          # the tag (or HEAD if it doesn't exist yet)
//   node scripts/release-notes.mjs v0.9.0 v0.8.0   # since a given tag
//
// It asks GitHub through the `gh` command line (signed in, or GH_TOKEN set).
// The draft is a start: say what matters at the top before publishing it.
import { execFileSync } from "node:child_process";

const [tag = "HEAD", since] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY ?? "Vulcio/Oneverse";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

const ref = tryGit("rev-parse", "--verify", "--quiet", `${tag}^{commit}`) ? tag : "HEAD";
// The previous release: the newest tag before this one that isn't a candidate.
const previous = since ?? tryGit("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*", "--exclude", "*-*", `${ref}^`);
const from = previous ? git("log", "-1", "--format=%cI", previous) : null;
const to = git("log", "-1", "--format=%cI", ref);

const query = [`repo:${repo}`, "is:issue", "is:closed", "reason:completed", from ? `closed:${from}..${to}` : `closed:<=${to}`].join(" ");
const issues = [];
for (let page = 1; page <= 10; page++) {
  const raw = execFileSync("gh", ["api", "-X", "GET", "search/issues", "-f", `q=${query}`, "-f", "per_page=100", "-f", `page=${page}`, "-f", "sort=created", "-f", "order=asc"], { encoding: "utf8" });
  const { items } = JSON.parse(raw);
  issues.push(...items);
  if (items.length < 100) break;
}

const labels = (issue) => issue.labels.map((label) => label.name);
const line = (issue) => `- ${issue.title} (#${issue.number})`;
const breaking = issues.filter((issue) => labels(issue).includes("breaking"));
const rest = issues.filter((issue) => !breaking.includes(issue));
const areaOf = (issue) => labels(issue).find((name) => name.startsWith("area: "))?.slice("area: ".length) ?? "other";
const areas = [...new Set(rest.map(areaOf))].sort((a, b) => (a === "other") - (b === "other") || a.localeCompare(b));

const out = [];
out.push(previous ? `Changes since ${previous}: ${issues.length} issues closed.` : `The first numbered release: ${issues.length} issues closed so far.`);
out.push("");
out.push("<!-- Say here what matters most in this release, and anything an operator must do when upgrading (Deploy.md, \"Upgrading and rolling back\"). -->");
out.push("");
if (breaking.length > 0) {
  out.push("## Changes that need attention", "", ...breaking.map(line), "");
}
for (const area of areas) {
  const inArea = rest.filter((issue) => areaOf(issue) === area);
  const fixes = inArea.filter((issue) => labels(issue).includes("bug"));
  const others = inArea.filter((issue) => !fixes.includes(issue));
  out.push(`## ${area[0].toUpperCase()}${area.slice(1)}`, "", ...others.map(line));
  if (fixes.length > 0) out.push(...fixes.map((issue) => `${line(issue)} - fix`));
  out.push("");
}
out.push("## Images", "");
const version = tag.replace(/^v/, "");
out.push(`Each app's image is \`ghcr.io/${repo.split("/")[0].toLowerCase()}/oneverse-<app>:${version}\` (api, songverse, planiverse, oneverse, screen, docs, site). How to pin one and roll back: Deploy.md.`);
process.stdout.write(`${out.join("\n")}\n`);
