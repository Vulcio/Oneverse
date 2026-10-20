// A screen's layers (issues #280, #287): drawn from the bottom - the base colour, the video input (the device's
// camera), the media, the content, the overlays, the masks - each shown, hidden or cleared until the next slide by the
// operator, for every screen or one of them; a screen's own settings keep some off whatever the operator does; the
// template editor sets the base, the video input, the masks and the layer a widget is on.
import { chromium } from "playwright";
import { WEB, api, call, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Layers admin");
const team = await api(admin, "POST", "/teams", { name: `Layers team ${stamp}` });
const set = await api(admin, "POST", "/setlists", { name: `Layers ${stamp}`, teamId: team.id });
const song = await api(admin, "POST", "/song-versions", {
  title: `Layers song ${stamp}`,
  language: "en",
  artists: ["Someone"],
  teamId: team.id,
  content: "{start_of_verse}\nFirst line here\nsecond line\nthird line here\nfourth line\n{end_of_verse}\n",
  contentFormat: "CHORDPRO",
});
await api(admin, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
const [item] = (await api(admin, "GET", `/setlists/${set.id}`)).items;
const theme = await api(admin, "POST", "/screen-themes", {
  name: `Layered ${stamp}`,
  teamId: team.id,
  theme: {
    base: { color: "#102030" },
    video: { source: "camera", fit: "cover" },
    background: { kind: "aurora", colors: ["#05010f", "#6d28d9", "#db2777"] },
    grid: {
      widgets: [
        { id: "words", kind: "current-slide", x: 0, y: 0, w: 12, h: 8 },
        { id: "clock", kind: "clock", x: 9, y: 10, w: 3, h: 2 },
        // The song's details, moved over to the overlays.
        { id: "song", kind: "song", layer: "overlays", x: 0, y: 10, w: 6, h: 2 },
      ],
    },
    masks: [
      { id: "corner", kind: "cover", shape: "rect", x: 0, y: 0, w: 10, h: 10 },
      { id: "window", kind: "window", shape: "ellipse", x: 60, y: 10, w: 30, h: 40, feather: 2 },
    ],
  },
});

// --- a screen's own layers, through the API
let r = await call(admin, "POST", "/screen-themes", { name: `Bad ${stamp}`, theme: { masks: [{ id: "m", shape: "star" }] } });
check("a mask of a shape no client draws is refused", r.status === 400, JSON.stringify(r.body));

// A real camera for the screens: Chromium's own test pattern, allowed without asking.
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
let leading;
try {
  const screenPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.grantPermissions(["camera"], { origin: WEB });
    return context.newPage();
  };
  const [hall, foyer] = [await screenPage(), await screenPage()];
  const desk = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  for (const one of [hall, foyer, desk]) one.on("pageerror", (error) => errors.push(error.message));
  const screens = {};
  const layersOf = async (tv) => (await tv.getByTestId("screen-stage").getAttribute("data-layers")).split(" ");
  const waitLayers = async (tv, want) => {
    await tv.waitForFunction(
      ([want]) => {
        const shown = (document.querySelector('[data-testid="screen-stage"]')?.getAttribute("data-layers") ?? "").split(" ");
        return Object.entries(want).every(([layer, on]) => shown.includes(layer) === on);
      },
      [want],
      { timeout: 8000 },
    );
  };

  await step("two screens on the set, in the layered template, presenting its song", async () => {
    for (const [tv, name] of [
      [hall, "Hall"],
      [foyer, "Foyer"],
    ]) {
      page = tv;
      await tv.goto(`${WEB}/screen`);
      const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
      screens[name] = await api(admin, "POST", `/screens/pairings/${code}/confirm`, { name: `${name} ${stamp}`, mode: "LYRICS", setlistId: set.id, themeId: theme.id, owner: { kind: "team", id: team.id } });
      await tv.getByTestId("screen-grid").first().waitFor({ timeout: 15000 });
    }
    leading = await syncDevice(admin);
    leading.send({ type: "join", setId: set.id });
    await leading.next((m) => m.type === "session");
    leading.send({ type: "lead" });
    await leading.next((m) => m.type === "session" && m.leading);
    leading.send({ type: "update", presenting: { itemId: item.id, slide: 0, black: false } });
    await hall.locator(`[data-testid="screen-showing"][data-item="${item.id}"]`).waitFor({ timeout: 10000 });
  });

  await step("the stack, in order: base colour, camera, media with its window, content, overlays, the black mask", async () => {
    page = hall;
    const order = await hall.locator('[data-testid="screen-stage"] > [data-layer]').evaluateAll((all) => all.map((one) => one.getAttribute("data-layer")));
    if (order.join(",") !== "base,video,media,content,overlays,masks") throw new Error(order.join(","));
    const base = await hall.locator('[data-layer="base"]').evaluate((one) => getComputedStyle(one).backgroundColor);
    if (base !== "rgb(16, 32, 48)") throw new Error(base);
    // The device's camera playing in the video input layer.
    await hall.waitForFunction(() => (document.querySelector('[data-testid="screen-video"]')?.videoWidth ?? 0) > 0, null, { timeout: 10000 });
    const window = await hall.locator('[data-layer="media"]').evaluate((one) => getComputedStyle(one).maskImage || getComputedStyle(one).webkitMaskImage);
    if (!window.includes("svg")) throw new Error(`no window cut through the media: ${window}`);
    if ((await hall.locator('[data-layer="masks"] [data-testid="screen-mask"]').count()) !== 1) throw new Error("not one black mask");
    if ((await hall.locator('[data-layer="content"] [data-kind="current-slide"]').count()) !== 1) throw new Error("the words aren't content");
    if ((await hall.locator('[data-layer="overlays"] [data-kind="clock"]').count()) !== 1) throw new Error("the clock isn't an overlay");
    if ((await hall.locator('[data-layer="overlays"] [data-kind="song"]').count()) !== 1) throw new Error("the song's details weren't moved to the overlays");
  });

  await step("over /sync: the media hidden on every screen; a layer that doesn't exist refused", async () => {
    leading.send({ type: "stage", layers: { show: { media: false } } });
    await waitLayers(hall, { media: false, content: true });
    await waitLayers(foyer, { media: false });
    leading.drain();
    leading.send({ type: "stage", layers: { show: { logo: false } } });
    r = await leading.next((m) => m.type === "error");
    check("…a layer that doesn't exist is refused", r?.code === "bad-request", JSON.stringify(r));
    leading.send({ type: "stage", layers: { show: { media: true } } });
    await waitLayers(hall, { media: true });
  });

  await step("the operator's panel: the overlays off on one screen only, then like all screens again", async () => {
    page = desk;
    await signIn(desk, admin);
    await desk.goto(`${WEB}/sets/${set.id}/operate`);
    await desk.getByTestId("operator-control").waitFor();
    await desk.getByTestId("operator-drawer-open").click();
    const drawer = desk.getByTestId("operator-drawer");
    await drawer.getByTestId("operator-screens").getByText(`Foyer ${stamp}`).waitFor({ timeout: 10000 });
    await drawer.getByTestId("operator-layers-for").selectOption({ label: `Foyer ${stamp}` });
    await drawer.getByTestId("operator-layer-overlays-shown").click();
    await drawer.locator('[data-testid="operator-layer-overlays"][data-state="hidden"]').waitFor({ timeout: 5000 });
    await waitLayers(foyer, { overlays: false });
    if (!(await layersOf(hall)).includes("overlays")) throw new Error("the other screen lost its overlays");
    // Every screen's choices still reach the one with its own.
    await drawer.getByTestId("operator-layers-for").selectOption({ value: "" });
    await drawer.getByTestId("operator-layer-masks-shown").click();
    await waitLayers(foyer, { masks: false, overlays: false });
    await waitLayers(hall, { masks: false, overlays: true });
    await drawer.getByTestId("operator-layer-masks-shown").click();
    await waitLayers(hall, { masks: true });
    await drawer.getByTestId("operator-layers-for").selectOption({ label: `Foyer ${stamp} · its own layers` });
    await drawer.getByTestId("operator-layers-reset").click();
    await waitLayers(foyer, { overlays: true, masks: true });
  });

  await step("Clear: the content gone until the next slide, then back by itself; Shift+W the same", async () => {
    page = desk;
    const drawer = desk.getByTestId("operator-drawer");
    await drawer.getByTestId("operator-layers-for").selectOption({ value: "" });
    await drawer.getByTestId("operator-layer-content-clear").click();
    await drawer.locator('[data-testid="operator-layer-content"][data-state="cleared"]').waitFor({ timeout: 5000 });
    await waitLayers(hall, { content: false, overlays: true });
    await waitLayers(foyer, { content: false });
    leading.send({ type: "update", presenting: { itemId: item.id, slide: 1, black: false } });
    await waitLayers(hall, { content: true });
    await waitLayers(foyer, { content: true });
    await drawer.locator('[data-testid="operator-layer-content"][data-state="shown"]').waitFor({ timeout: 5000 });
    // The keys, with nothing focused.
    await desk.getByRole("heading", { name: "Operator" }).click();
    await desk.keyboard.press("Shift+W");
    await waitLayers(hall, { content: false });
    leading.send({ type: "update", presenting: { itemId: item.id, slide: 0, black: false } });
    await waitLayers(hall, { content: true });
    await desk.keyboard.press("g");
    await waitLayers(hall, { media: false });
    await desk.keyboard.press("c");
    await waitLayers(hall, { media: true, content: true });
  });

  await step("a screen that never shows the media (its settings): not even when the operator shows it", async () => {
    r = await call(admin, "PATCH", `/screens/${screens.Hall.id}`, { hiddenLayers: ["hologram"] });
    check("…a layer that doesn't exist is refused", r.status === 400, JSON.stringify(r.body));
    page = desk;
    await desk.goto(`${WEB}/screens`);
    await desk.getByTestId(`screen-Hall ${stamp}`).getByTestId("screen-settings").click();
    const dialog = desk.getByTestId("screen-dialog");
    // The box follows the screen as the API sends it back.
    await dialog.getByTestId("screen-layer-media").click();
    await dialog.locator('[data-testid="screen-layer-media"]:not(:checked)').waitFor({ timeout: 5000 });
    await waitLayers(hall, { media: false, content: true });
    await dialog.locator('[data-testid="theme-preview"] [data-testid="screen-stage"]:not([data-layers~="media"])').waitFor();
    const [kept] = (await api(admin, "GET", "/screens")).filter((one) => one.id === screens.Hall.id);
    if (kept.hiddenLayers.join() !== "media") throw new Error(JSON.stringify(kept));
    leading.send({ type: "stage", layers: { show: { media: true } } });
    await hall.waitForTimeout(800);
    if ((await layersOf(hall)).includes("media")) throw new Error("the operator overrode the screen's settings");
    if (!(await layersOf(foyer)).includes("media")) throw new Error("the other screen lost its media");
    await dialog.getByTestId("screen-dialog-done").click();
  });

  await step("the screen's menu: its camera picked, kept on the device", async () => {
    page = hall;
    await hall.keyboard.press("ContextMenu");
    await hall.getByTestId("screen-menu").waitFor();
    await hall.getByTestId("screen-menu-videos").click();
    await hall.locator('[data-testid="screen-menu"][data-view="videos"]').waitFor();
    const cameras = hall.getByTestId("screen-menu-camera");
    for (let i = 0; i < 20 && (await cameras.count()) < 2; i++) await hall.waitForTimeout(200);
    if ((await cameras.count()) < 2) throw new Error("the device's camera isn't listed");
    await cameras.nth(1).click();
    await hall.getByTestId("screen-menu").waitFor({ state: "detached" });
    if (!(await hall.evaluate(() => localStorage.getItem("songverse.screen.videoInput")))) throw new Error("the camera wasn't kept");
    await hall.waitForFunction(() => (document.querySelector('[data-testid="screen-video"]')?.videoWidth ?? 0) > 0, null, { timeout: 10000 });
  });

  await step("the template editor: the base, the video input, a mask, a widget's layer", async () => {
    page = desk;
    await desk.goto(`${WEB}/screens?tab=templates`);
    await desk.getByTestId("new-theme").click();
    const editor = desk.getByTestId("theme-editor");
    await editor.getByTestId("theme-group-layers").locator("summary").click();
    await editor.getByTestId("theme-base-same").uncheck();
    await editor.getByTestId("theme-base-color").fill("#204060");
    await editor.getByTestId("theme-video-source").locator('[data-value="camera"]').click();
    // A preview doesn't open a camera: a placeholder where it goes.
    await editor.getByTestId("screen-video-placeholder").waitFor();
    await editor.getByTestId("theme-add-mask").click();
    await editor.getByTestId("theme-mask").getByTestId("theme-mask-kind").locator('[data-value="window"]').click();
    await editor.getByTestId("theme-group-widgets").locator("summary").click();
    await editor.getByTestId("theme-widget-add").selectOption("song");
    await editor.getByTestId("theme-widget-layer").selectOption("overlays");
    await editor.locator('[data-testid="theme-preview"] [data-layer="overlays"] [data-kind="song"]').waitFor();
    await editor.getByLabel("Name").fill(`Edited layers ${stamp}`);
    await editor.getByTestId("theme-save").click();
    await desk.getByTestId(`saved-theme-Edited layers ${stamp}`).waitFor();
    const saved = (await api(admin, "GET", "/screen-themes")).find((one) => one.name === `Edited layers ${stamp}`);
    const widget = saved?.theme.grid?.widgets.find((one) => one.kind === "song");
    if (saved?.theme.base.color !== "#204060" || saved.theme.video.source !== "camera" || saved.theme.masks[0]?.kind !== "window" || widget?.layer !== "overlays") throw new Error(JSON.stringify(saved?.theme));
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  leading?.close();
  await browser.close();
  for (const one of await api(admin, "GET", "/screens")) await api(admin, "DELETE", `/screens/${one.id}`);
}
finish();
