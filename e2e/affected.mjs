// Which suites a change needs on a pull request (issue #315): run.mjs's
// `--changed <file>` (the changed paths, one a line). A path in one of the
// areas below runs the suites whose name has one of its words; a suite
// file changed runs itself; documentation needs none. Anything else -
// a shared package, the harness, the API's core, a lockfile, an area not
// listed - runs every suite, as main always does. Add an area once its
// suites are known to cover it; when unsure, leave it out.

/** By path prefix: words in the names of the suites that cover it. */
export const AREAS = {
  "apps/api/src/sync/": ["sync", "split-control", "screen", "live", "offline-sync"],
  "apps/api/src/screens/": ["screen", "split-control", "pulse"],
  "apps/api/src/scriptures/": ["bible", "passage", "youversion"],
  "apps/api/src/team-events/": ["calendar", "availability", "event", "lineup", "rehearsals", "reminders", "swaps", "locations"],
  "apps/api/src/organizations/": ["organization", "groups", "planiverse", "locations"],
  "apps/api/src/stem-separation/": ["stem", "sonic-servers"],
  "apps/api/src/recordings/": ["recording", "opus", "practice-audio"],
  "apps/api/src/notifications/": ["notification", "push", "reminders"],
  "apps/api/src/brands/": ["brands"],
  "apps/api/src/locations/": ["locations", "pulse-pairing"],
  "apps/api/src/artists/": ["artists"],
  "apps/screen/": ["screen", "split-control", "pulse"],
  "apps/pulse/": ["pulse", "live-handback"],
  "apps/planiverse/": ["planiverse", "organization", "groups", "team-calendar", "event"],
  "packages/screen/": ["screen", "live"],
  "packages/operator/": ["screen-console", "screen-operator", "live", "split-control", "pulse"],
};

/** Changes no suite has anything to say about. */
const NOTHING = /^(apps\/docs\/|apps\/site\/|docs\/)|\.md$/;
/** A suite itself. */
const SUITE = /^e2e\/((?:api|web)\/[^/]+)\.test\.mjs$/;

/** The suites `files` need, out of `all`; null: every one. */
export function affected(files, all) {
  const chosen = new Set();
  for (const file of files) {
    if (NOTHING.test(file)) continue;
    const suite = SUITE.exec(file)?.[1];
    if (suite) {
      chosen.add(suite);
      continue;
    }
    const area = Object.keys(AREAS).find((prefix) => file.startsWith(prefix));
    if (!area) return null;
    for (const name of all) if (AREAS[area].some((word) => name.split("/")[1].includes(word))) chosen.add(name);
  }
  return all.filter((name) => chosen.has(name));
}
