// Screen widgets on a template's grid (issue #268): the API takes a grid and refuses a bad one; the editor
// starts from the Stage display layout, moves and resizes a widget, adds one and saves; a screen using the
// template draws each widget in its cells - the slide now and the next one, the clock, a countdown until a
// time, the song and the next song, words of one's own - and Black hides only the words when it says so.
import { chromium } from "playwright";
import { SCREEN, WEB, api, call, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const leader = await user("Widget maker");
const set = await api(leader, "POST", "/setlists", { name: `Widgets ${stamp}` });
const content = (first) => `{key: G}\n{start_of_verse}\n${first} line here\nsecond line here\nthird line here\nfourth line here\n{end_of_verse}\n`;
const first = await api(leader, "POST", "/song-versions", { title: `First song ${stamp}`, language: "en", artists: ["Someone"], content: content("First"), contentFormat: "CHORDPRO" });
const second = await api(leader, "POST", "/song-versions", { title: `Second song ${stamp}`, language: "en", artists: ["Someone"], content: content("Other"), contentFormat: "CHORDPRO" });
await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: first.id });
await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: second.id });

// --- the API
let r = await call(leader, "POST", "/screen-themes", { name: "Bad", theme: { grid: { widgets: [{ id: "a", kind: "clock", x: 0, y: 0, w: 2, h: 1, sparkle: 1 }] } } });
check("a widget's unknown field is refused, by name", r.status === 400 && JSON.stringify(r.body).includes("sparkle"), JSON.stringify(r.body));
r = await call(leader, "POST", "/screen-themes", { name: "Bad", theme: { grid: { widgets: [{ id: "a", kind: "weather", x: 0, y: 0, w: 2, h: 1 }] } } });
check("an unknown kind of widget is refused", r.status === 400, JSON.stringify(r.body));
r = await call(leader, "POST", "/screen-themes", { name: "Bad", theme: { grid: { widgets: [{ id: "a", kind: "countdown", x: 0, y: 0, w: 2, h: 1, options: { source: "until", until: "25:00" } }] } } });
check("a time of day is HH:MM", r.status === 400 && JSON.stringify(r.body).includes("until"), JSON.stringify(r.body));
r = await call(leader, "POST", "/screen-themes", { name: `Grid ${stamp}`, theme: { grid: { columns: 6, rows: 4, widgets: [{ id: "c", kind: "clock", x: 4, y: 0, w: 2, h: 1 }] } } });
check("a grid saved with its widgets' defaults", r.status === 201 && r.body.theme.grid.widgets[0].options.format === "24h" && r.body.theme.grid.black === "all", JSON.stringify(r.body));
await api(leader, "DELETE", `/screen-themes/${r.body.id}`);

const browser = await chromium.launch();
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const tablet = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errors = [];
  tv.on("pageerror", (error) => errors.push(error.message));
  tablet.on("pageerror", (error) => errors.push(error.message));
  const editor = tablet.getByTestId("theme-editor");
  let theme;

  await step("the editor: Stage display on its grid; a widget dragged, resized, one added, saved", async () => {
    page = tablet;
    await signIn(tablet, leader);
    await tablet.goto(`${WEB}/screens?tab=templates`);
    await tablet.getByTestId("builtin-theme-stage-display").getByTestId("customize-theme").click();
    const overlay = editor.getByTestId("theme-grid-overlay");
    await overlay.waitFor();
    // Each box over the preview is where its widget is drawn, whatever the window's size.
    const aligned = async () => {
      for (const [id, kind] of [["clock", "clock"], ["countdown", "countdown"], ["current", "current-slide"], ["message", "message"]]) {
        const box = await overlay.getByTestId(`grid-widget-${kind}`).boundingBox();
        const cell = await editor.getByTestId("theme-preview").getByTestId(`widget-cell-${id}`).boundingBox();
        if (!box || !cell || ["x", "y", "width", "height"].some((key) => Math.abs(box[key] - cell[key]) > 2)) throw new Error(`${id}: box ${JSON.stringify(box)}, drawn ${JSON.stringify(cell)}`);
      }
    };
    await aligned();
    await tablet.setViewportSize({ width: 1920, height: 1000 });
    await tablet.waitForTimeout(300);
    await aligned();
    await tablet.setViewportSize({ width: 1440, height: 1000 });
    await tablet.waitForTimeout(300);
    // The clock, one cell to the left: dragged.
    const clock = overlay.getByTestId("grid-widget-clock");
    if ((await clock.getAttribute("data-place")) !== "8,0,4,2") throw new Error(await clock.getAttribute("data-place"));
    const box = await clock.boundingBox();
    const cell = (await overlay.boundingBox()).width / 12;
    await tablet.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tablet.mouse.down();
    await tablet.mouse.move(box.x + box.width / 2 - cell * 0.6, box.y + box.height / 2, { steps: 5 });
    await tablet.mouse.move(box.x + box.width / 2 - cell, box.y + box.height / 2, { steps: 5 });
    await tablet.mouse.up();
    await tablet.waitForFunction(() => document.querySelector('[data-testid="grid-widget-clock"]')?.getAttribute("data-place") === "7,0,4,2");
    // Picked, its options: the seconds off. Then one row taller, from the keyboard.
    await editor.locator('[data-testid="theme-widget-settings"][data-kind="clock"]').waitFor();
    await editor.getByTestId("theme-widget-seconds").uncheck();
    await clock.focus();
    await tablet.keyboard.press("Shift+ArrowDown");
    await tablet.waitForFunction(() => document.querySelector('[data-testid="grid-widget-clock"]')?.getAttribute("data-place") === "7,0,4,3");
    // A countdown until a time of day, instead of the operator's.
    await overlay.getByTestId("grid-widget-countdown").click();
    await editor.getByTestId("theme-widget-source").selectOption("until");
    await editor.getByTestId("theme-widget-until").fill("23:59");
    // Words of one's own, added.
    await editor.getByTestId("theme-widget-add").selectOption("text");
    await editor.getByTestId("theme-widget-text").fill(`Wi-Fi ${stamp}`);
    await editor.getByTestId("theme-preview").getByTestId("widget-text").getByText(`Wi-Fi ${stamp}`).waitFor();
    await editor.getByTestId("theme-grid-black").selectOption("words");
    await editor.getByLabel("Name").fill(`Stage ${stamp}`);
    await editor.getByTestId("theme-save").click();
    await tablet.getByTestId(`saved-theme-Stage ${stamp}`).waitFor();
    theme = (await api(leader, "GET", "/screen-themes")).find((one) => one.name === `Stage ${stamp}`);
    const widgets = Object.fromEntries(theme.theme.grid.widgets.map((one) => [one.kind, one]));
    if (widgets.clock.x !== 7 || widgets.clock.h !== 3 || widgets.clock.options.seconds !== false) throw new Error(JSON.stringify(widgets.clock));
    if (widgets.countdown.options.source !== "until" || widgets.countdown.options.until !== "23:59") throw new Error(JSON.stringify(widgets.countdown));
    if (widgets.text.options.text !== `Wi-Fi ${stamp}` || theme.theme.grid.black !== "words") throw new Error(JSON.stringify(theme.theme.grid));
  });

  await step("a screen using it: each widget in its cells, the clock and the countdown ticking", async () => {
    page = tv;
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    await api(leader, "POST", `/screens/pairings/${code}/confirm`, { name: `Stage ${stamp}`, mode: "LYRICS", setlistId: set.id, themeId: theme.id });
    await tv.getByTestId("screen-grid").first().waitFor({ timeout: 15000 });
    await tv.getByTestId("widget-text").getByText(`Wi-Fi ${stamp}`).waitFor();
    const clock = await tv.getByTestId("widget-clock").innerText();
    if (!/^\d{2}:\d{2}$/.test(clock.trim())) throw new Error(`clock: ${clock}`);
    const countdown = tv.getByTestId("widget-countdown");
    const before = await countdown.innerText();
    if (!/^(\d+:)?\d{1,2}:\d{2}$/.test(before.trim())) throw new Error(`countdown: ${before}`);
    await tv.waitForFunction((was) => document.querySelector('[data-testid="widget-countdown"]')?.textContent !== was, before, { timeout: 5000 });
    // Nothing presented: no slides, no song.
    if ((await tv.getByTestId("widget-current-slide").count()) + (await tv.getByTestId("widget-song").count()) > 0) throw new Error("a slide before anything's presented");
  });

  await step("presented: the slide now and the next, the song and what's next", async () => {
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
    await tv.getByTestId("widget-current-slide").getByText("First line here").waitFor({ timeout: 10000 });
    await tv.getByTestId("widget-next-slide").getByText("third line here").waitFor();
    await tv.getByTestId("widget-song").getByText(`First song ${stamp}`).waitFor();
    await tv.getByTestId("widget-song").getByText("G", { exact: true }).waitFor();
    await tv.getByTestId("widget-next-song").getByText(`Second song ${stamp}`, { exact: false }).waitFor();
    // The song's last slide: the next slide is the next song's first.
    page = tablet;
    await tablet.getByTestId("present-next").click();
    page = tv;
    await tv.getByTestId("widget-next-slide").getByText("Other line here").waitFor();
  });

  await step("Black hides only the words: the clock and the text stay", async () => {
    page = tablet;
    await tablet.getByTestId("present-black").click();
    page = tv;
    await tv.getByTestId("widget-current-slide").waitFor({ state: "detached", timeout: 5000 });
    await tv.getByTestId("widget-clock").waitFor();
    await tv.getByTestId("widget-text").getByText(`Wi-Fi ${stamp}`).waitFor();
    if ((await tv.getByTestId("screen-black").getAttribute("data-on")) !== null) throw new Error("the whole screen went black");
    page = tablet;
    await tablet.getByTestId("present-black").click();
    page = tv;
    await tv.getByTestId("widget-current-slide").waitFor();
  });

  await step("more widgets (issue #272): the sections, the song's structure, the set's items, an analog clock, a countdown's colours by time", async () => {
    const saved = (await api(leader, "GET", "/screen-themes")).find((one) => one.id === theme.id);
    const widgets = [
      { id: "section", kind: "current-section", x: 0, y: 0, w: 6, h: 6 },
      { id: "after", kind: "next-section", x: 0, y: 6, w: 6, h: 3 },
      { id: "structure", kind: "song-structure", x: 0, y: 9, w: 6, h: 3 },
      { id: "item", kind: "current-item", x: 6, y: 0, w: 6, h: 2 },
      { id: "next-item", kind: "next-item", x: 6, y: 2, w: 6, h: 2 },
      { id: "dial", kind: "analog-clock", x: 6, y: 4, w: 3, h: 4, options: { seconds: true } },
      { id: "late", kind: "countdown", x: 9, y: 4, w: 3, h: 4, options: { source: "until", until: "23:59", breakpoints: [{ at: 86400, color: "#ffffff", background: "#dc2626" }] } },
    ];
    await api(leader, "PATCH", `/screen-themes/${theme.id}`, { template: { ...saved.template, grid: { ...saved.template.grid, black: "all", widgets } } });
    page = tv;
    const section = tv.getByTestId("widget-current-section");
    await section.getByText("third line here").waitFor({ timeout: 10000 });
    // The slide on screen (the second) picked out among the section's lines.
    if ((await section.locator("[data-now]").allInnerTexts()).join(" / ") !== "third line here / fourth line here") throw new Error(await section.innerText());
    await tv.getByTestId("widget-next-section").getByText("Other line here").waitFor();
    const structure = tv.getByTestId("widget-song-structure");
    await structure.locator("[data-now]").waitFor();
    if ((await tv.getByTestId("widget-song-progress").getAttribute("data-progress")) !== "100") throw new Error("not at the end of the song");
    await tv.getByTestId("widget-current-item").getByText(`First song ${stamp}`).waitFor();
    await tv.getByTestId("widget-current-item").getByText("1 of 2").waitFor();
    await tv.getByTestId("widget-next-item").getByText(`Second song ${stamp}`, { exact: false }).waitFor();
    const time = await tv.getByTestId("widget-analog-clock").getAttribute("data-time");
    const now = new Date();
    if (time !== `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}` && !time) throw new Error(`analog clock: ${time}`);
    await tv.locator('[data-testid="widget-countdown"] [data-color="#ffffff"]').waitFor();
    await tv.locator('[data-testid="widget-timer-background"][data-color="#dc2626"]').waitFor();
    await api(leader, "PATCH", `/screen-themes/${theme.id}`, { template: saved.template });
    await tv.getByTestId("widget-song-structure").waitFor({ state: "detached", timeout: 10000 });
  });

  await step("a date, the slide count (the song's and the set's) and a QR code (issue #289)", async () => {
    const saved = (await api(leader, "GET", "/screen-themes")).find((one) => one.id === theme.id);
    const widgets = [
      { id: "day", kind: "date", x: 0, y: 0, w: 6, h: 3, options: { dateFormat: "iso", time: true } },
      { id: "song-count", kind: "slide-count", x: 0, y: 3, w: 6, h: 3 },
      { id: "set-count", kind: "slide-count", x: 0, y: 6, w: 6, h: 3, options: { scope: "set", progress: "thick" } },
      { id: "wifi", kind: "qr-code", x: 6, y: 0, w: 6, h: 9, options: { label: "Wi-Fi", qr: { kind: "wifi", ssid: "Guests", password: "pa;ss" } } },
    ];
    await api(leader, "PATCH", `/screen-themes/${theme.id}`, { template: { ...saved.template, grid: { ...saved.template.grid, widgets } } });
    page = tv;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await tv.getByTestId("widget-date").getByText(today).waitFor({ timeout: 10000 });
    // The second slide of the first song (two each): 2 / 2 of the song, 2 / 4 of the set.
    const counts = tv.getByTestId("widget-slide-count");
    await counts.first().waitFor();
    const seen = await counts.evaluateAll((all) => all.map((one) => `${one.getAttribute("data-position")}/${one.getAttribute("data-count")}`));
    if (seen.join(" ") !== "2/2 2/4") throw new Error(seen.join(" "));
    if ((await tv.getByTestId("widget-slide-progress").count()) !== 2) throw new Error("no progress bars");
    const qr = tv.getByTestId("widget-qr-code");
    if ((await qr.getAttribute("data-payload")) !== "WIFI:T:WPA;S:Guests;P:pa\\;ss;;") throw new Error(await qr.getAttribute("data-payload"));
    await qr.locator("svg").waitFor();
    await qr.getByText("Wi-Fi").waitFor();
    await api(leader, "PATCH", `/screen-themes/${theme.id}`, { template: saved.template });
    await tv.getByTestId("widget-qr-code").waitFor({ state: "detached", timeout: 10000 });
  });

  await step("the editor: a countdown's colours by time, added", async () => {
    page = tablet;
    await tablet.goto(`${WEB}/screens?tab=templates`);
    await tablet.getByTestId(`saved-theme-Stage ${stamp}`).getByTestId("edit-theme").click();
    await editor.getByTestId("theme-grid-overlay").getByTestId("grid-widget-countdown").click();
    await editor.getByTestId("theme-widget-breakpoint-add").click();
    await editor.getByTestId("theme-widget-breakpoint-add").click();
    await editor.getByTestId("theme-widget-breakpoint-at").nth(1).fill("0:30");
    await editor.getByTestId("theme-widget-breakpoint-at").nth(1).blur();
    await editor.getByTestId("theme-widget-breakpoint-background").nth(1).check();
    await editor.getByTestId("theme-widget-add").selectOption("analog-clock");
    await editor.getByTestId("theme-preview").getByTestId("widget-analog-clock").waitFor();
    await editor.getByTestId("theme-save").click();
    await editor.waitFor({ state: "detached" });
    const after = (await api(leader, "GET", "/screen-themes")).find((one) => one.id === theme.id);
    const countdown = after.theme.grid.widgets.find((one) => one.kind === "countdown");
    if (JSON.stringify(countdown.options.breakpoints) !== JSON.stringify([{ at: 300, color: "#f59e0b", background: null }, { at: 30, color: "#f59e0b", background: "#dc2626" }])) throw new Error(JSON.stringify(countdown.options.breakpoints));
    if (!after.theme.grid.widgets.some((one) => one.kind === "analog-clock")) throw new Error("no analog clock");
    page = tv;
  });

  await step("the Widgets tab (issue #273): each widget live; a default look saved, then put on the widget as it's added", async () => {
    page = tablet;
    await tablet.goto(`${WEB}/screens?tab=widgets`);
    const list = tablet.getByTestId("widgets-list");
    await list.getByTestId("widget-analog-clock").getByTestId("widget-analog-clock").waitFor();
    if ((await list.getByTestId("theme-preview").count()) !== 19) throw new Error(`previews: ${await list.getByTestId("theme-preview").count()}`);
    await list.getByTestId("widget-countdown").getByTestId("widget-countdown").waitFor();
    await list.getByTestId("widget-countdown").getByTestId("widget-customize").click();
    const dialog = tablet.getByTestId("widget-default-editor");
    await dialog.getByTestId("theme-widget-opacity").fill("0.8");
    await dialog.getByTestId("theme-widget-label").fill(`Talk ${stamp}`);
    await dialog.getByTestId("theme-preview").getByText(`Talk ${stamp}`).waitFor();
    await dialog.getByTestId("widget-default-save").click();
    await dialog.waitFor({ state: "detached" });
    await list.locator('[data-testid="widget-countdown"][data-customized]').getByText("Your look").waitFor();
    const saved = (await api(leader, "GET", "/screen-widget-defaults")).find((one) => one.kind === "countdown");
    if (saved?.look.style.opacity !== 0.8 || saved.look.options.label !== `Talk ${stamp}`) throw new Error(JSON.stringify(saved));
    // Added to a template: it comes with that look.
    await tablet.goto(`${WEB}/screens?tab=templates`);
    await tablet.getByTestId("new-theme").click();
    await editor.getByTestId("theme-group-widgets").locator("summary").click();
    await editor.getByTestId("theme-widget-add").selectOption("countdown");
    await editor.getByTestId("theme-widget-label").waitFor();
    if ((await editor.getByTestId("theme-widget-label").inputValue()) !== `Talk ${stamp}`) throw new Error("the default look wasn't put on the widget");
    await editor.getByRole("button", { name: "Close" }).last().click();
    // A QR code's address, set in its default: the preview encodes it.
    await tablet.goto(`${WEB}/screens?tab=widgets`);
    await tablet.getByTestId("widgets-list").getByTestId("widget-qr-code").getByTestId("widget-customize").click();
    const qrDialog = tablet.getByTestId("widget-default-editor");
    await qrDialog.getByTestId("theme-widget-qr-url").fill(`https://example.org/${stamp}`);
    await qrDialog.locator(`[data-testid="widget-qr-code"][data-payload="https://example.org/${stamp}"]`).waitFor();
    await qrDialog.getByRole("button", { name: "Close" }).last().click();
    await qrDialog.waitFor({ state: "detached" });
    // Back to the built-in look.
    await tablet.goto(`${WEB}/screens?tab=widgets`);
    await tablet.getByTestId("widgets-list").getByTestId("widget-countdown").getByTestId("widget-customize").click();
    await tablet.getByTestId("widget-default-reset").click();
    await tablet.getByTestId("widget-default-editor").waitFor({ state: "detached" });
    if ((await api(leader, "GET", "/screen-widget-defaults")).some((one) => one.kind === "countdown")) throw new Error("still there");
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await browser.close();
  for (const screen of await api(leader, "GET", "/screens")) await api(leader, "DELETE", `/screens/${screen.id}`);
}
finish();
