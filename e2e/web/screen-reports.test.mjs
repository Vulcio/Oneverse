// Screen reports (issue #286): a connected screen says what it is and how it's drawing, every half minute over /sync -
// its browser, GPU and WebGL, cores and memory, the frame rate of its moving background - and its owner sees it on
// Screens: a tier on its tile, its device in its settings. Only a screen reports; someone else's screens show none.
import { chromium } from "playwright";
import { SCREEN, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Reports admin");
const other = await user("Reports other");
const set = await api(admin, "POST", "/setlists", { name: `Reports ${stamp}` });
const template = await api(admin, "POST", "/screen-themes", { name: `Reported ${stamp}`, content: { builtIn: "concert" }, background: { builtIn: "mesh-gradient" }, effects: { builtIn: "concert" } });

const browser = await chromium.launch();
let device;
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const desk = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  for (const one of [tv, desk]) one.on("pageerror", (error) => errors.push(error.message));
  page = tv;
  const name = `Reporting TV ${stamp}`;
  let screen;

  await step("a screen drawing a shader reports its device and frame rate", async () => {
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    await api(admin, "POST", `/screens/pairings/${code}/confirm`, { name, setlistId: set.id, themeId: template.id });
    await tv.locator('[data-testid="screen-shader"][data-state="drawing"]').waitFor({ timeout: 15000 });
    // The first report, a few seconds after it connects.
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      screen = (await api(admin, "GET", "/screens")).find((one) => one.name === name);
      if (screen?.report) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const report = screen?.report;
    if (!report) throw new Error("no report");
    if (report.device.webgl < 1 || !report.device.cores || !report.device.browser) throw new Error(`device: ${JSON.stringify(report.device)}`);
    if (report.drawing.drawer !== "shader" || !(report.drawing.fps > 0) || report.drawing.scale === null) throw new Error(`drawing: ${JSON.stringify(report.drawing)}`);
    if (!["smooth", "limited", "minimal"].includes(report.tier) || !report.at) throw new Error(JSON.stringify(report));
  });

  await step("only its owner sees it", async () => {
    const theirs = await api(other, "GET", "/screens");
    if (theirs.some((one) => one.id === screen.id && one.report)) throw new Error("someone else saw the report");
  });

  await step("someone signed in, not a screen, can't report", async () => {
    device = await syncDevice(admin);
    device.send({ type: "report", report: { device: { webgl: 2 } } });
    const answer = await device.next((m) => m.type === "error");
    if (answer.code !== "forbidden") throw new Error(JSON.stringify(answer));
  });

  await step("on Screens: its tier on the tile, its device in its settings", async () => {
    page = desk;
    await signIn(desk, admin);
    await desk.goto(`${WEB}/screens`);
    const tile = desk.getByTestId(`screen-${name}`);
    await tile.locator(`[data-testid="screen-tier"][data-tier="${screen.report.tier}"]`).waitFor();
    await tile.getByTestId("screen-settings").click();
    const dialog = desk.getByTestId("screen-dialog");
    const section = dialog.getByTestId("screen-device");
    await section.waitFor();
    if ((await section.getAttribute("data-tier")) !== screen.report.tier) throw new Error("another tier in the dialog");
    const text = await section.innerText();
    if (!text.includes("WebGL") || !/fps/.test(text)) throw new Error(text);
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  device?.close();
  await browser.close();
  for (const one of await api(admin, "GET", "/screens")) await api(admin, "DELETE", `/screens/${one.id}`);
}
finish();
