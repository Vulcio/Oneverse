// Continuing on Pulse (issue #247, docs/live-session.md, "How the room's
// devices reach Pulse"): Pulse tells the cloud its address on the venue's
// network, Live asks for a pass, and when Live loses the cloud it offers
// "Continue on Pulse": Pulse's own page, the operator's console built for it
// (`build:pulse` in the screen app), with the set from Pulse's copy and Next
// applied by Pulse. The room's slide is the cloud's once it's back. Pulse's
// link, room and page run in this process, the link's connection to the API
// cut and restored on demand; Live's is cut in the browser.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { API, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";
import { CloudLink } from "../../apps/pulse/dist/cloud-link.js";
import { ConsolePage } from "../../apps/pulse/dist/console-page.js";
import { Room } from "../../apps/pulse/dist/room.js";
import { SetCopy } from "../../apps/pulse/dist/set-copy.js";

let page;
const step = stepper(() => page);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const leader = await user("Pulse page");
const set = await api(leader, "POST", "/setlists", { name: `Pulse page ${stamp}` });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo\n\nThree" } });
const itemId = items[0].id;
const until = async (test, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 100))) if (test()) return true;
  return false;
};

// Pulse: its server first, for the address it tells the cloud.
let link;
const copy = new SetCopy({ apiUrl: API, setId: set.id, token: async () => leader.bearer });
const consolePage = new ConsolePage(path.join(repo, "apps/screen/dist/pulse"));
const server = createServer(async (request, response) => {
  if (!(await room.handle(request, response)) && !(await consolePage.handle(request, response))) response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const PULSE = `http://127.0.0.1:${server.address().port}`;
let down = false;
let current = null;
link = new CloudLink({
  apiUrl: API,
  setId: set.id,
  nodeId: `pulse-page-${stamp}`,
  roomUrl: PULSE,
  token: async () => leader.bearer,
  outageMs: 1500,
  open: (url) => {
    if (down) {
      const dead = { readyState: 3, send() {}, close() {}, onopen: null, onmessage: null, onclose: null };
      setTimeout(() => dead.onclose?.(), 50);
      return dead;
    }
    current = new WebSocket(url);
    return current;
  },
});
const room = new Room(server, link, set.id, copy);

const watcher = await syncDevice(leader);
const browser = await chromium.launch();
// While on, Live can't reach the cloud: its socket closed, and every new one.
const cut = { on: false };
let liveSocket = null;
try {
  await step("Pulse's page is built, and Pulse follows the set while the cloud's there", async () => {
    execFileSync("pnpm", ["--filter", "@oneverse/screen-app", "build:pulse"], { cwd: repo, stdio: "pipe" });
    link.start();
    if (!(await until(() => link.status === "online" && !!link.passKey))) throw new Error(`Pulse is ${link.status}`);
    if (!(await copy.refresh())) throw new Error("no copy of the set");
  });

  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await context.routeWebSocket((url) => url.href.startsWith(`${API.replace(/^http/, "ws")}/`), (ws) => {
    if (cut.on) return ws.close();
    liveSocket = ws;
    ws.connectToServer();
  });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await step("without a pass, Pulse's page points to Live's link", async () => {
    await page.goto(`${PULSE}/`);
    await page.getByTestId("pulse-problem").getByText("Continue on Pulse").waitFor();
  });

  await step("Live leads the set and presents; the cloud tells it where Pulse is, not as someone in the set", async () => {
    await signIn(page, leader);
    await page.evaluate(() => localStorage.setItem("songverse.mode", "live"));
    await page.goto(`${WEB}/sets/${set.id}/live/${itemId}`);
    const control = page.getByTestId("sync-control").first();
    await control.click();
    await page.getByTestId("sync-menu").getByRole("menuitem", { name: "Turn sync on" }).click();
    await page.locator('[data-testid="sync-control"][data-state-sync="on"]').first().waitFor();
    // Once in the set (its clock measured first): the menu offers the lead.
    for (let tries = 0; ; tries++) {
      await control.click();
      const lead = page.getByTestId("sync-menu").getByRole("menuitem", { name: "Lead the set" });
      if (await lead.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
        await lead.click();
        break;
      }
      if (tries === 5) throw new Error("Live never offered the lead");
      await page.keyboard.press("Escape");
    }
    await page.locator('[data-testid="sync-control"][data-state-sync="leading"]').first().waitFor();
    await control.click();
    await page.getByTestId("sync-present").click();
    await page.locator('[data-testid="present-panel"][data-slide="0"]').waitFor();
    watcher.send({ type: "join", setId: set.id });
    const heard = await watcher.next((m) => m.type === "session" && m.session?.presenting?.slide === 0 && m.pulse === PULSE, 10000);
    if (!heard) throw new Error("the set's devices aren't told where Pulse is");
    if (heard.members.length !== 2) throw new Error(`members: ${JSON.stringify(heard.members)}`);
    if (!(await until(() => link.engine.state?.presenting?.slide === 0))) throw new Error("Pulse doesn't follow");
  });

  await step("the cloud gone: the room runs the session, and Live offers to continue on Pulse", async () => {
    down = true;
    current.close();
    cut.on = true;
    liveSocket?.close();
    if (!(await until(() => link.status === "room"))) throw new Error(`Pulse is ${link.status}`);
    await page.getByTestId("continue-on-pulse").waitFor();
  });

  await step("on Pulse's page: the set's console, from Pulse, the pass out of the address bar", async () => {
    await page.getByTestId("continue-on-pulse").getByRole("link", { name: "Continue on Pulse" }).click();
    await page.getByTestId("pulse-banner").waitFor();
    await page.locator('[data-testid="operator-slide"][data-slide="0"][aria-current="true"]').waitFor();
    if (!page.url().startsWith(PULSE) || page.url().includes("pass=")) throw new Error(`the address is ${page.url()}`);
  });

  await step("Next: Pulse moves the screens", async () => {
    await page.getByTestId("operator-next").click();
    await page.locator('[data-testid="operator-slide"][data-slide="1"][aria-current="true"]').waitFor();
    if (!(await until(() => link.engine.state?.presenting?.slide === 1))) throw new Error(`Pulse shows slide ${link.engine.state?.presenting?.slide}`);
  });

  await step("reloaded: still in, the pass kept for the tab", async () => {
    await page.reload();
    await page.locator('[data-testid="operator-slide"][data-slide="1"][aria-current="true"]').waitFor();
  });

  await step("the cloud back: the room's slide is the cloud's", async () => {
    const epoch = link.engine.state.epoch;
    down = false;
    if (!(await until(() => link.status === "online" && !link.engine.runs))) throw new Error(`Pulse is ${link.status}`);
    const after = await watcher.next((m) => m.type === "session" && m.session?.epoch === epoch + 1, 5000);
    if (after?.session.presenting?.slide !== 1) throw new Error(JSON.stringify(after?.session));
    if (errors.length) throw new Error(errors.join("; "));
  });
} finally {
  await browser.close();
  watcher.close();
  room.close();
  server.close();
  link.stop();
}

finish();
