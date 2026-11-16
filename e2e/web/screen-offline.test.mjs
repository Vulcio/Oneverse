// A screen that loses the network (issue #195): it keeps its set, its template and the template's files on the
// device; with the sync gone, the remote's, keyboard's or clicker's keys move the slides on the screen itself; a reload
// with no network still opens it on the slide it showed, background and all; back online, the session's slide wins
// (a screen is a read-only member of it: nothing moved by hand is sent).
import { chromium } from "playwright";
import { API, SCREEN, api, finish, stamp, stepper, user } from "../lib/harness.mjs";
import { png } from "../lib/fake-providers.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const leader = await user("Offline screen");
const set = await api(leader, "POST", "/setlists", { name: `Offline ${stamp}` });
const song = await api(leader, "POST", "/song-versions", {
  title: `Offline song ${stamp}`,
  language: "en",
  artists: ["Band"],
  content: "{start_of_verse}\nFirst line kept\nSecond line kept\n{end_of_verse}\n{start_of_chorus}\nChorus line kept\nAnother chorus line\n{end_of_chorus}\n",
  contentFormat: "CHORDPRO",
});
await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "Coffee after the service" } });
const [songItem, textItem] = items;
// A template with a picture of its own for a background: a file the screen keeps.
const background = await api(leader, "POST", "/screen-parts", { kind: "background", name: `Kept picture ${stamp}`, document: { background: { kind: "gradient" } } });
const form = new FormData();
form.append("file", new Blob([png(30, 120, 200)], { type: "image/png" }), "kept.png");
const asset = await (await fetch(`${API}/screen-parts/${background.id}/assets?kind=media`, { method: "POST", headers: { Authorization: `Bearer ${leader.bearer}` }, body: form })).json();
await api(leader, "PATCH", `/screen-parts/${background.id}`, { document: { background: { kind: "image", media: asset.id } } });
const template = await api(leader, "POST", "/screen-themes", { name: `Kept ${stamp}`, background: { id: background.id } });

const browser = await chromium.launch();
let leading;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // The sync's socket, cut on demand: what a dropped Wi-Fi does to it.
  let cut = false;
  const sockets = new Set();
  await context.routeWebSocket(/\/sync/, (ws) => {
    if (cut) return ws.close();
    ws.connectToServer();
    sockets.add(ws);
  });
  const goOffline = async () => {
    cut = true;
    await context.setOffline(true);
    for (const ws of sockets) await ws.close().catch(() => undefined);
    sockets.clear();
  };
  const goOnline = async () => {
    cut = false;
    await context.setOffline(false);
  };
  const tv = await context.newPage();
  const errors = [];
  tv.on("pageerror", (error) => errors.push(error.message));
  page = tv;
  const showing = (itemId, slide, black = false) => tv.locator(`[data-testid="screen-showing"][data-item="${itemId}"][data-slide="${slide}"][data-black="${black}"]`).waitFor({ timeout: 10000 });
  const pictureShown = () => tv.waitForFunction(() => document.querySelector('[data-testid="screen-stage"][data-background="image"] img[data-testid="screen-media"]')?.naturalWidth > 0, null, { timeout: 10000 });

  await step("paired and presented: the set, the template and its picture kept on the device", async () => {
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    await api(leader, "POST", `/screens/pairings/${code}/confirm`, { name: `Offline TV ${stamp}`, setlistId: set.id, themeId: template.id });
    leading = await syncDevice(leader);
    leading.send({ type: "join", setId: set.id });
    await leading.next((m) => m.type === "session");
    leading.send({ type: "lead" });
    await leading.next((m) => m.type === "session" && m.leading);
    leading.send({ type: "update", presenting: { itemId: songItem.id, slide: 0, black: false } });
    await tv.getByTestId("screen-lines").getByText("First line kept").waitFor({ timeout: 15000 });
    await pictureShown();
    // The service worker in charge of the page, and the picture in its cache.
    await tv.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 });
    await tv.waitForFunction(async () => (await (await caches.open("oneverse-screen-files")).keys()).some((req) => req.url.includes("/screen-themes/assets/")), null, { timeout: 15000, polling: 500 });
  });

  await step("the network gone: a quiet sign in the corner, and the keys move the slides on the screen", async () => {
    await goOffline();
    await tv.getByTestId("screen-offline").waitFor();
    await tv.keyboard.press("ArrowRight");
    await showing(songItem.id, 1);
    await tv.getByTestId("screen-lines").getByText("Chorus line kept").waitFor();
    // A clicker's Page Down: on to the next item, the text.
    await tv.keyboard.press("PageDown");
    await showing(textItem.id, 0);
    await tv.getByTestId("screen-lines").getByText("Coffee after the service").waitFor();
    await tv.keyboard.press("ArrowLeft");
    await showing(songItem.id, 1);
    // Black, and back.
    await tv.keyboard.press("b");
    await showing(songItem.id, 1, true);
    await tv.keyboard.press("ArrowRight");
    await showing(songItem.id, 1);
  });

  await step("reloaded with no network: the page, the set, the slide it showed and the picture, from the device", async () => {
    await tv.reload();
    await showing(songItem.id, 1);
    await tv.getByTestId("screen-lines").getByText("Chorus line kept").waitFor();
    await pictureShown();
    await tv.getByTestId("screen-offline").waitFor();
    await tv.keyboard.press("ArrowLeft");
    await showing(songItem.id, 0);
  });

  await step("back online: the session's slide wins; online, the keys leave the slides to the operator", async () => {
    leading.send({ type: "update", presenting: { itemId: textItem.id, slide: 0, black: false } });
    await leading.next((m) => m.type === "session" && m.session?.presenting?.itemId === textItem.id);
    await goOnline();
    await showing(textItem.id, 0);
    await tv.getByTestId("screen-offline").waitFor({ state: "detached", timeout: 15000 });
    // Online, the keys don't move the slides: the operator does.
    await tv.keyboard.press("ArrowLeft");
    await tv.waitForTimeout(500);
    await showing(textItem.id, 0);
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  leading?.close();
  await browser.close();
}
finish();
