// Shared setup for the end-to-end suites: where the running API and web
// app are, test users, API calls, and pass/fail reporting. Each suite is a
// plain Node script (`node e2e/api/sets.test.mjs`); `e2e/run.mjs` runs them all.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const API = process.env.E2E_API_URL ?? "http://localhost:3001";
export const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3000";
/** The web app's origin, which the API trusts for auth calls. */
export const ORIGIN = WEB;
/** Planiverse (issue #241): the planning on its own, signed in to with the same account. */
export const PLANIVERSE = process.env.E2E_PLANIVERSE_URL ?? "http://localhost:3002";
/** Where everyone signs in (issue #303): the apps send people there and back. */
export const ONEVERSE = process.env.E2E_ONEVERSE_URL ?? "http://localhost:3003";
/** The screen app (issue #305): what big screens open. */
export const SCREEN = process.env.E2E_SCREEN_URL ?? "http://localhost:3004";
/** The API's console output: with no email provider configured, it prints the emails it would send (verification links etc.). */
export const LOG = process.env.E2E_API_LOG ?? "/tmp/api-dev.log";
export const DB = (process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/songverse_dev").replace(/\?.*$/, "");
/** Where the API keeps uploads when no object storage is configured (it runs from apps/api). */
export const STORAGE_DIR =
  process.env.E2E_STORAGE_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/api/.data/attachments");
/** Screenshots of failed steps. */
export const SP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.artifacts");
mkdirSync(SP, { recursive: true });

export const stamp = Date.now();
export const tag = String(stamp % 100000);
export const results = [];
/** The running suite's name, e.g. "sets", which prefixes its users' emails. */
const suite = path.basename(process.argv[1] ?? "e2e").replace(/\.test\.mjs$/, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

/** Runs SQL against the test database and returns the text output. */
export const sql = (q) => execSync(`psql ${DB} -tAc ${JSON.stringify(q)}`).toString().trim();

/** Gives a user a built-in role (issue #160): "REVIEWER", "STEM_SEPARATION" or "AUDIO_UPLOADS" (#183). */
export const giveRole = (userId, builtIn) =>
  sql(`insert into "RoleAssignment" (id, "roleId", "userId") select 'ra_' || md5(random()::text), id, '${userId}' from "Role" where "builtIn" = '${builtIn}' on conflict do nothing`);

export function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` -> ${detail}` : ""}`);
}

/** A browser step: failures are recorded (with a screenshot of `getPage()`), not thrown. */
export function stepper(getPage) {
  return async function step(name, fn) {
    try {
      await fn();
      results.push(true);
      console.log(`OK   ${name}`);
    } catch (err) {
      results.push(false);
      console.log(`FAIL ${name} -> ${err.message.split("\n")[0]}`);
      await getPage()
        ?.screenshot({ path: `${SP}/${suite}-fail-${results.length}.png`, fullPage: true })
        .catch(() => {});
    }
  };
}

/** Where the API log ends now, to look for emails sent after this point. */
export const logOffset = () => readFileSync(LOG, "utf8").length;

/** The first match of `pattern` in the API log after `offset`, waiting up to ~9s for it. */
export async function waitForLog(offset, pattern) {
  for (let i = 0; i < 30; i++) {
    const match = readFileSync(LOG, "utf8").slice(offset).match(pattern);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`nothing matching ${pattern} in the API log`);
}

const VERIFY_LINK = new RegExp(`${API.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/auth/verify-email\\?token=[^\\s&]+`);

/** Signs up a verified user (password "hunter2pass") and returns their email, API token and id. */
export async function user(name) {
  const email = `e2e-${suite}-${String(name).toLowerCase().replace(/\s+/g, "-")}-${stamp}@example.com`;
  const offset = logOffset();
  await fetch(`${API}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email, password: "hunter2pass", name: String(name) }),
  });
  const [link] = await waitForLog(offset, VERIFY_LINK);
  await fetch(link, { redirect: "manual" });
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email, password: "hunter2pass" }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const bearer = (await (await fetch(`${API}/api/auth/token`, { headers: { cookie, Origin: ORIGIN } })).json()).token;
  const id = sql(`select id from "User" where email='${email}'`);
  // Uploading audio files is a role's (issue #183), which people who sign up don't get: the suites' users have it.
  giveRole(id, "AUDIO_UPLOADS");
  // "What do you play or do?" (issue #109) would cover the page they're tested on: skipped, as a returning user would have.
  // A suite about it asks again with askProfileAgain().
  sql(`update "User" set "profilePromptSkippedAt" = now() where id = '${id}'`);
  return { email, bearer, cookie, id };
}

/** Lets "What do you play or do?" (issue #109) ask `who` again, as for someone who just signed up. */
export const askProfileAgain = (who) => {
  // Joining a team asks again too; a suite testing the prompt keeps that.
  who.wantsProfilePrompt = true;
  sql(`update "User" set "profilePromptSkippedAt" = null where id = '${who.id}'`);
};

/** An API call as `who`; returns the status and parsed body. */
export async function call(who, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${who.bearer}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // Joining a team asks "What do you play or do?" again (issue #109): skipped, as for every user(), unless a suite wants it.
  if (method === "POST" && path.startsWith("/teams/join/") && res.ok && who.id && !who.wantsProfilePrompt) {
    sql(`update "User" set "profilePromptSkippedAt" = now() where id = '${who.id}'`);
  }
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

/** An API call as `who`; returns just the parsed body. */
export const api = async (who, method, path, body) => (await call(who, method, path, body ?? undefined)).body;

/** Signs `who` in through Oneverse's sign-in form, where the web app sends them (issue #303). */
export async function signIn(p, who) {
  await p.goto(WEB);
  await p.waitForURL(`${ONEVERSE}/sign-in**`);
  await p.waitForLoadState("networkidle");
  await p.fill("#signin-email", who.email);
  await p.fill("#signin-password", "hunter2pass");
  await p.getByRole("button", { name: /Sign in|Se connecter/, exact: false }).first().click();
  await p.waitForURL("**/library");
  await p.waitForLoadState("networkidle");
}

/** A section's link on the sidebar's rail ("Sets", "Library"…): inside a section, on a wider screen (#80). */
export const railLink = (p, section) => p.getByTestId("sidebar-rail").getByRole("link", { name: section, exact: true });

/** Goes to a section's page from the sidebar: its rail, or the full sidebar on a section's own page. */
export async function sidebarGo(p, section) {
  if (await p.getByTestId("sidebar-rail").count()) await railLink(p, section).click();
  else await p.locator('[data-slot="sidebar"]').getByRole("link", { name: section, exact: true }).click();
}

/**
 * An entry of the sidebar's (a song, a set…) under `section`: in the
 * panel inside a section (following the section's rail link first if the
 * panel shows another), or in the full sidebar's list.
 */
export async function sidebarEntry(p, section, name) {
  const panel = p.getByTestId("sidebar-panel");
  if (!(await panel.count())) return p.locator('[data-slot="sidebar"]').getByRole("link", { name });
  if ((await panel.getAttribute("aria-label")) !== `${section} list`) {
    await sidebarGo(p, section);
    await p.waitForFunction((label) => document.querySelector('[data-testid="sidebar-panel"]')?.getAttribute("aria-label") === label, `${section} list`);
  }
  return panel.getByRole("link", { name });
}

/** Prints the tally; any failure makes the process exit non-zero. */
export function finish() {
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
}

/** The Songs list's Status column, hidden at first (issue #168), shown as a user would choose it - before going to the list. */
export async function showStatusColumn(p) {
  await p.evaluate(() => localStorage.setItem("songverse.library.columns", JSON.stringify({ columns: [{ id: "artist", shown: true }, { id: "publicationState", shown: true }] })));
}

/**
 * Waits until none of the song's files is being processed (issue #182: an
 * audio upload above 320 kbps - a 48 kHz WAV - is made Opus by the Worker,
 * as a new file); returns its files then.
 */
export async function settledFiles(who, songVersionId, timeout = 30000) {
  const until = Date.now() + timeout;
  for (;;) {
    const files = await api(who, "GET", `/song-versions/${songVersionId}/attachments`);
    if (!files.some((file) => file.processing === "PENDING")) return files;
    if (Date.now() > until) throw new Error(`still processing: ${files.filter((file) => file.processing === "PENDING").map((file) => file.filename).join(", ")}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Sets one display setting from the page's Display panel (issue #209): opens
 * it, picks the section (on a phone), presses the choice (its test id, `display-<field>-<value>`),
 * and closes it again so it doesn't cover the page.
 */
export async function displaySetting(p, section, choice) {
  const open = (await p.getByTestId("display-panel").count()) > 0;
  if (!open) await p.getByTestId("display-open").first().click();
  const panel = p.getByTestId("display-panel");
  await panel.waitFor();
  // On a phone, the section from the list; a large screen shows them all.
  if ((await panel.getByTestId("display-section").count()) > 0) {
    await panel.getByTestId("display-section").click();
    await p.getByTestId(`display-section-${section}`).click();
  }
  // A large screen's section folded away (issue #265): opened first.
  const block = panel.getByTestId(`display-block-${section}`);
  if ((await block.count()) > 0 && (await block.getAttribute("data-folded")) !== null) await panel.getByTestId(`display-fold-${section}`).click();
  await panel.getByTestId(choice).click();
  await panel.getByTestId("display-close").click();
  await panel.waitFor({ state: "detached" });
}

/** Puts the page's mode back to the account's display settings (issue #209), from the Display panel. */
export async function resetDisplay(p) {
  await p.getByTestId("display-open").first().click();
  const panel = p.getByTestId("display-panel");
  await panel.getByTestId("display-reset").click();
  await panel.getByTestId("display-close").click();
  await panel.waitFor({ state: "detached" });
}

/**
 * Picks a day ("YYYY-MM-DD") on the app's calendar (react-day-picker,
 * issue #235) within `scope`: on to the next month until it shows, then
 * clicked. The calendar must already be open.
 */
export async function pickDay(scope, day) {
  for (let i = 0; i < 24; i++) {
    const cell = scope.locator(`td[data-day="${day}"]:not([data-outside]) button`).first();
    if (await cell.count()) {
      await cell.click();
      return;
    }
    await scope.locator(".rdp-button_next").first().click();
  }
  throw new Error(`The calendar never showed ${day}`);
}
