// Screen templates (issues #194, #281): built-in looks and saved ones (a person's or a team's), picked per screen; made
// of parts - a content theme, a background theme, effects - each edited on its own with a live preview, from the
// template's editor or their own lists; a change shows on the screen at once; `?theme=` pins a built-in one on a
// device. Every client reads the same documents.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { API, SCREEN, SP, WEB, api, call, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { png } from "../lib/fake-providers.mjs";

const FONT = new URL("../../packages/screen/node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2", import.meta.url);

let page;
const step = stepper(() => page);
const leader = await user("Theme maker");
const member = await user("Theme member");
const team = await api(leader, "POST", "/teams", { name: `Venue ${stamp}` });
const link = await api(leader, "POST", `/teams/${team.id}/invite-links`, { role: "MEMBER" });
await api(member, "POST", `/teams/join/${link.token}`);
const set = await api(leader, "POST", "/setlists", { name: `Themed ${stamp}` });
const song = await api(leader, "POST", "/song-versions", {
  title: `Themed song ${stamp}`,
  language: "en",
  artists: ["Someone"],
  content: "{start_of_verse}\nFirst line here\nsecond line here\nthird line here\nfourth line here\n{end_of_verse}\n",
  contentFormat: "CHORDPRO",
});
await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });

// --- the API
let r = await call(leader, "POST", "/screen-themes", { name: "Mine", theme: { background: { kind: "aurora", colors: ["#000000", "#ff0000"] }, sparkle: true } });
check("an unknown field is refused, by name", r.status === 400 && JSON.stringify(r.body).includes("sparkle"), JSON.stringify(r.body));
r = await call(leader, "POST", "/screen-themes", { name: "Mine", theme: { text: { color: "red" } } });
check("a colour is #rrggbb", r.status === 400, JSON.stringify(r.body));
const mine = await api(leader, "POST", "/screen-themes", { name: `Mine ${stamp}`, theme: { background: { kind: "aurora", colors: ["#000000", "#ff0000"] } } });
check("saved with every default filled in", mine.theme.text.font === "sans" && mine.theme.background.kind === "aurora" && mine.canEdit, JSON.stringify(mine));
const teamTheme = await api(leader, "POST", "/screen-themes", { name: `Venue look ${stamp}`, teamId: team.id, theme: { text: { font: "elegant" } } });
check("a team's theme, by its admin", teamTheme.ownerTeamId === team.id && teamTheme.teamName === `Venue ${stamp}`);
{
  const seen = await api(member, "GET", "/screen-themes");
  check("its members see it, but can't change it", seen.some((one) => one.id === teamTheme.id && !one.canEdit) && !seen.some((one) => one.id === mine.id), JSON.stringify(seen));
  r = await call(member, "PATCH", `/screen-themes/${teamTheme.id}`, { name: "Mine now" });
  check("a member changing it: refused", r.status === 403, String(r.status));
  r = await call(member, "POST", "/screen-themes", { name: "Ours", teamId: team.id, theme: {} });
  check("a member adding one for the team: refused", r.status === 403, String(r.status));
}
r = await call(member, "PATCH", `/screen-themes/${mine.id}`, { name: "Taken" });
check("someone else's: not found", r.status === 404, String(r.status));

const browser = await chromium.launch();
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const tablet = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errors = [];
  tv.on("pageerror", (error) => errors.push(error.message));
  tablet.on("pageerror", (error) => errors.push(error.message));
  const stage = () => tv.getByTestId("screen-stage");
  let screen;

  await step("paired with a built-in theme: the screen shows it, waiting for the set", async () => {
    page = tv;
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    screen = await api(leader, "POST", `/screens/pairings/${code}/confirm`, { name: `TV ${stamp}`, mode: "LYRICS", setlistId: set.id, themeTemplate: "concert" });
    if (screen.themeTemplate !== "concert") throw new Error(JSON.stringify(screen));
    await tv.locator('[data-testid="screen-display"][data-state="showing"]').waitFor({ timeout: 15000 });
    await tv.locator('[data-testid="screen-stage"][data-background="aurora"][data-transition="blur"][data-reveal="words"]').waitFor();
    await tv.getByTestId("screen-idle").waitFor();
  });

  await step("a built-in template customized: its background and its words made the user's own, from the template's editor", async () => {
    page = tablet;
    await signIn(tablet, leader);
    await tablet.goto(`${WEB}/screens?tab=templates`);
    const builtIn = tablet.getByTestId("builtin-theme-chapel");
    await builtIn.getByTestId("screen-lyrics").first().waitFor();
    // Tagged, and filtered by tag (issue #281).
    await builtIn.getByTestId("template-tags").getByText("Audience").waitFor();
    await tablet.getByTestId("templates-tags").locator('[data-value="chords"]').click();
    await builtIn.waitFor({ state: "detached" });
    await tablet.getByTestId("builtin-theme-band-chart").waitFor();
    await tablet.getByTestId("templates-tags").locator('[data-value="chords"]').click();
    await builtIn.getByTestId("customize-theme").click();
    const editor = tablet.getByTestId("theme-editor");
    await editor.getByTestId("theme-preview").waitFor();
    // The background, customized into one of the user's own.
    await editor.getByTestId("theme-part-background-open").click();
    let part = tablet.getByTestId("part-editor");
    await part.getByTestId("theme-background").locator('[data-value="particles"]').click();
    await part.locator('[data-testid="theme-preview"] [data-background="particles"]').waitFor();
    await part.locator("#theme-name").fill(`Starry sky ${stamp}`);
    await part.getByTestId("theme-save").click();
    await part.waitFor({ state: "detached" });
    await editor.locator('[data-testid="theme-preview"] [data-background="particles"]').waitFor();
    // The words too.
    await editor.getByTestId("theme-part-content-open").click();
    part = tablet.getByTestId("part-editor");
    await part.getByTestId("theme-transition").locator('[data-value="zoom"]').click();
    await part.getByTestId("theme-reveal").locator('[data-value="letters"]').click();
    // A step in the preview: the next slide comes in letter by letter, over the template's background.
    await part.getByTestId("theme-preview-next").click();
    await part.locator('[data-testid="theme-preview"] [data-background="particles"] .sv-reveal-letters .sv-piece').first().waitFor();
    // Unreadable colours are flagged.
    await part.getByTestId("theme-text-color").fill("#111111");
    await part.getByTestId("theme-contrast").getByText("Low contrast", { exact: false }).waitFor();
    await part.getByTestId("theme-text-color").fill("#fff7e6");
    await part.getByTestId("theme-contrast").getByText("Contrast", { exact: false }).waitFor();
    await tablet.screenshot({ path: `${SP}/screen-theme-editor.png` });
    await part.locator("#theme-name").fill(`Starry words ${stamp}`);
    await part.getByTestId("theme-save").click();
    await part.waitFor({ state: "detached" });
    await editor.getByTestId("theme-tags").locator('[data-value="presentation"]').click();
    await editor.locator("#theme-name").fill(`Starry ${stamp}`);
    await editor.getByTestId("theme-save").click();
    await tablet.getByTestId(`saved-theme-Starry ${stamp}`).waitFor();
    const saved = (await api(leader, "GET", "/screen-themes")).find((one) => one.name === `Starry ${stamp}`);
    if (saved?.theme.background.kind !== "particles" || saved.theme.motion.reveal !== "letters" || saved.theme.text.font !== "elegant" || saved.parts.background.name !== `Starry sky ${stamp}` || !saved.template.tags.includes("presentation"))
      throw new Error(JSON.stringify(saved));
  });

  await step("picked for the screen from its row: the screen changes at once", async () => {
    // From the Screens tab (issue #267): its tile's settings.
    await tablet.getByTestId("screens-tab-screens").click();
    const row = tablet.getByTestId(`screen-TV ${stamp}`);
    // Its settings, in a dialog (issue #288).
    await row.getByTestId("screen-settings").click();
    const dialog = tablet.getByTestId("screen-dialog");
    await dialog.getByLabel("Template").selectOption({ label: `Starry ${stamp}` });
    await dialog.getByTestId("theme-preview").waitFor();
    await dialog.getByTestId("screen-dialog-done").click();
    await dialog.waitFor({ state: "detached" });
    page = tv;
    await tv.locator('[data-testid="screen-stage"][data-background="particles"]').waitFor();
    await tv.locator(`[data-testid="screen-showing"][data-theme]`).waitFor();
  });

  await step("its background theme changed: the screen showing the template follows", async () => {
    const saved = (await api(leader, "GET", "/screen-themes")).find((one) => one.name === `Starry ${stamp}`);
    const [background] = (await api(leader, "GET", "/screen-parts?kind=background")).filter((one) => one.id === saved.parts.background.id);
    await api(leader, "PATCH", `/screen-parts/${background.id}`, { document: { ...background.document, background: { ...background.document.background, kind: "waves" } } });
    await tv.locator('[data-testid="screen-stage"][data-background="waves"]').waitFor();
  });

  await step("presented: the words in the theme's font, the reveal and the reactive background", async () => {
    page = tablet;
    await tablet.evaluate(() => localStorage.setItem("songverse.mode", "live"));
    const [item] = (await api(leader, "GET", `/setlists/${set.id}`)).items;
    await tablet.goto(`${WEB}/sets/${set.id}/live/${item.id}`);
    const control = tablet.getByTestId("sync-control").first();
    await control.click();
    await tablet.getByTestId("sync-menu").getByRole("menuitem", { name: "Turn sync on" }).click();
    await tablet.locator('[data-testid="sync-control"][data-state-sync="on"]').first().waitFor();
    await control.click();
    await tablet.getByTestId("sync-menu").getByRole("menuitem", { name: "Lead the set" }).click();
    await tablet.locator('[data-testid="sync-control"][data-state-sync="leading"]').first().waitFor();
    await control.click();
    await tablet.getByTestId("sync-present").click();
    page = tv;
    await tv.getByTestId("screen-lines").getByText("First line here").waitFor();
    const family = await tv.getByTestId("screen-stage").evaluate((el) => getComputedStyle(el).fontFamily);
    if (!family.includes("Playfair")) throw new Error(family);
    await tv.waitForTimeout(1200);
    await tv.screenshot({ path: `${SP}/screen-theme-tv.png` });
    // The next slide: the one before goes out while it comes in.
    page = tablet;
    await tablet.getByTestId("present-next").click();
    page = tv;
    await tv.getByTestId("screen-lines").getByText("third line here").waitFor();
  });

  await step("Move: the words on both slides glide to their new place (issue #324)", async () => {
    const saved = (await api(leader, "GET", "/screen-themes")).find((one) => one.name === `Starry ${stamp}`);
    const [content] = (await api(leader, "GET", "/screen-parts?kind=content")).filter((one) => one.id === saved.parts.content.id);
    const changed = { ...content.document, lines: { ...content.document.lines, group: "slide", before: 1, after: 1 }, motion: { ...content.document.motion, transition: "move", duration: 1500, reveal: "none" } };
    await api(leader, "PATCH", `/screen-parts/${content.id}`, { document: changed });
    await tv.locator('[data-testid="screen-stage"][data-transition="move"]').waitFor();
    page = tablet;
    await tablet.getByTestId("present-previous").click();
    page = tv;
    await tv.getByTestId("screen-lines").getByText("First line here").waitFor();
    await tv.waitForTimeout(1600);
    // "second line here" is on both slides (the current line, then the line before): it moves rather than fading.
    const moving = tv.waitForFunction(
      () => document.getAnimations().some((one) => one.effect?.target?.hasAttribute?.("data-word") && JSON.stringify(one.effect.getKeyframes()).includes("translate")),
      null,
      { polling: "raf", timeout: 10000 },
    );
    page = tablet;
    await tablet.getByTestId("present-next").click();
    page = tv;
    await moving;
    await tv.screenshot({ path: `${SP}/screen-theme-move.png` });
    await tv.getByTestId("screen-lines").getByText("third line here").waitFor();
    await tv.getByTestId("screen-before").getByText("second", { exact: false }).waitFor();
  });

  await step("a picture for the background theme and a font for the content theme, from their own lists: on the screen", async () => {
    page = tablet;
    await tablet.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
    await tablet.goto(`${WEB}/screens?tab=templates`);
    await tablet.getByTestId("templates-view-background").click();
    await tablet.getByTestId(`saved-part-Starry sky ${stamp}`).getByText("Used by 1 template").waitFor();
    await tablet.getByTestId(`saved-part-Starry sky ${stamp}`).getByTestId("edit-part").click();
    let editor = tablet.getByTestId("part-editor");
    await editor.getByTestId("theme-background").locator('[data-value="image"]').click();
    await editor.getByTestId("theme-upload-media").setInputFiles({ name: "stage.png", mimeType: "image/png", buffer: png(40, 90, 160) });
    await editor.getByTestId("theme-media").getByText("stage.png").waitFor();
    await editor.locator('[data-testid="theme-preview"] img[data-testid="screen-media"]').waitFor();
    await editor.getByTestId("theme-save").click();
    await editor.waitFor({ state: "detached" });
    await tablet.getByTestId("templates-view-content").click();
    await tablet.getByTestId(`saved-part-Starry words ${stamp}`).getByTestId("edit-part").click();
    editor = tablet.getByTestId("part-editor");
    await editor.getByTestId("theme-upload-font").setInputFiles({ name: "bebas.woff2", mimeType: "font/woff2", buffer: readFileSync(FONT) });
    await editor.getByTestId("theme-custom-font").locator("option", { hasText: "bebas.woff2" }).waitFor({ state: "attached" });
    await editor.getByTestId("theme-save").click();
    await editor.waitFor({ state: "detached" });
    page = tv;
    await tv.locator('[data-testid="screen-stage"][data-background="image"] img[data-testid="screen-media"]').waitFor();
    await tv.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="screen-stage"]')).fontFamily.includes("sv-theme-"));
    await tv.waitForFunction(() => [...document.fonts].some((face) => face.family.startsWith("sv-theme-") && face.status === "loaded"));
  });

  await step("a theme's files: at a signed address, only pictures, videos and fonts", async () => {
    const saved = (await api(leader, "GET", "/screen-themes")).find((one) => one.name === `Starry ${stamp}`);
    const picture = saved.assets.find((asset) => asset.kind === "media");
    const font = saved.assets.find((asset) => asset.kind === "font");
    if (saved.theme.background.media !== picture?.id || saved.theme.text.customFont !== font?.id) throw new Error(JSON.stringify(saved));
    let res = await fetch(picture.url);
    if (res.status !== 200 || res.headers.get("content-type") !== "image/png") throw new Error(`${res.status} ${res.headers.get("content-type")}`);
    res = await fetch(picture.url.replace(/signature=[^&]+/, "signature=forged"));
    if (res.status !== 403) throw new Error(`forged: ${res.status}`);
    // A font is read as bytes, never shown as a page.
    res = await fetch(font.url);
    if (res.status !== 200 || res.headers.get("content-type") !== "application/octet-stream") throw new Error(`font: ${res.status} ${res.headers.get("content-type")}`);
    const form = new FormData();
    form.append("file", new Blob(["<script>alert(1)</script>"], { type: "text/html" }), "page.html");
    const background = saved.parts.background.id;
    res = await fetch(`${API}/screen-parts/${background}/assets?kind=media`, { method: "POST", headers: { Authorization: `Bearer ${leader.bearer}` }, body: form });
    if (res.status !== 400) throw new Error(`html: ${res.status}`);
    res = await fetch(`${API}/screen-parts/${background}/assets?kind=media`, { method: "POST", headers: { Authorization: `Bearer ${member.bearer}` }, body: form });
    if (res.status !== 404) throw new Error(`someone else's part: ${res.status}`);
    // A font goes with words, a picture with a background.
    res = await fetch(`${API}/screen-parts/${background}/assets?kind=font`, { method: "POST", headers: { Authorization: `Bearer ${leader.bearer}` }, body: form });
    if (res.status !== 400) throw new Error(`a font on a background: ${res.status}`);
  });

  await step("?theme= pins a built-in theme on this device", async () => {
    await tv.goto(`${SCREEN}/?theme=stream`);
    await tv.locator('[data-testid="screen-stage"][data-background="color"][data-transition="slide"]').waitFor({ timeout: 15000 });
    await tv.goto(`${SCREEN}/?theme=nonsense`);
    await tv.locator('[data-testid="screen-stage"][data-background="image"]').waitFor({ timeout: 15000 });
  });

  await step("the theme deleted: its screen goes back to the default look", async () => {
    const saved = (await api(leader, "GET", "/screen-themes")).find((one) => one.name === `Starry ${stamp}`);
    await api(leader, "DELETE", `/screen-themes/${saved.id}`);
    await tv.locator('[data-testid="screen-stage"][data-background="color"][data-transition="fade"]').waitFor();
    const [current] = await api(leader, "GET", `/screens?setlistId=${set.id}`);
    if (current.themeId !== null) throw new Error(JSON.stringify(current));
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await browser.close();
}
finish();
