// Pulse's own page (issue #247, docs/live-session.md, "How the room's devices
// reach Pulse"): the operator's console built for Pulse
// (`build:pulse` in the screen app), served by Pulse on the venue's network.
// With the cloud gone, a device opens it with the pass the cloud signed
// (`#pass=`): the set from Pulse's copy, Next applied by Pulse, and the room's
// slide the cloud's once it's back. Pulse's link, room and page run in this
// process, the link's connection to the API cut and restored on demand.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { API, api, finish, stamp, stepper, user } from "../lib/harness.mjs";
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

let down = false;
let current = null;
const link = new CloudLink({
  apiUrl: API,
  setId: set.id,
  nodeId: `pulse-page-${stamp}`,
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
const copy = new SetCopy({ apiUrl: API, setId: set.id, token: async () => leader.bearer });
const consolePage = new ConsolePage(path.join(repo, "apps/screen/dist/pulse"));
const server = createServer(async (request, response) => {
  if (!(await room.handle(request, response)) && !(await consolePage.handle(request, response))) response.writeHead(404).end();
});
const room = new Room(server, link, set.id, copy);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const PULSE = `http://127.0.0.1:${server.address().port}`;

const tablet = await syncDevice(leader);
let browser;
try {
  await step("Pulse's page is built, and Pulse follows the set while the cloud's there", async () => {
    execFileSync("pnpm", ["--filter", "@oneverse/screen-app", "build:pulse"], { cwd: repo, stdio: "pipe" });
    tablet.send({ type: "join", setId: set.id, deviceId: `tablet-${stamp}` });
    await tablet.next((m) => m.type === "session");
    tablet.send({ type: "command", id: `lead-${stamp}`, op: { kind: "lead" } });
    tablet.send({ type: "command", id: `one-${stamp}`, op: { kind: "present", presenting: { itemId, slide: 1, black: false }, basedOn: 0 } });
    await tablet.next((m) => m.type === "ack" && m.id === `one-${stamp}`);
    link.start();
    if (!(await until(() => link.status === "online" && !!link.passKey && link.engine.state?.presenting?.slide === 1))) throw new Error(`Pulse is ${link.status}`);
    if (!(await copy.refresh())) throw new Error("no copy of the set");
  });

  tablet.send({ type: "pass" });
  const pass = (await tablet.next((m) => m.type === "pass"))?.pass;

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await step("without a pass: sent back to Live's link", async () => {
    await page.goto(`${PULSE}/`);
    await page.getByTestId("pulse-problem").getByText("Continue on Pulse").waitFor();
  });

  await step("the cloud gone: the room runs the session", async () => {
    down = true;
    current.close();
    if (!(await until(() => link.status === "room"))) throw new Error(`Pulse is ${link.status}`);
  });

  await step("opened with the pass: the set's console, from Pulse, the pass out of the address bar", async () => {
    await page.goto(`${PULSE}/#pass=${pass}`);
    await page.getByTestId("pulse-banner").waitFor();
    await page.locator('[data-testid="operator-slide"][data-slide="1"][aria-current="true"]').waitFor();
    if (page.url().includes("pass=")) throw new Error(`the address is ${page.url()}`);
  });

  await step("Next: Pulse moves the screens", async () => {
    await page.getByTestId("operator-next").click();
    await page.locator('[data-testid="operator-slide"][data-slide="2"][aria-current="true"]').waitFor();
    if (!(await until(() => link.engine.state?.presenting?.slide === 2))) throw new Error(`Pulse shows slide ${link.engine.state?.presenting?.slide}`);
  });

  await step("reloaded: still in, the pass kept for the tab", async () => {
    await page.reload();
    await page.locator('[data-testid="operator-slide"][data-slide="2"][aria-current="true"]').waitFor();
  });

  await step("the cloud back: the room's slide is the cloud's", async () => {
    const epoch = link.engine.state.epoch;
    down = false;
    if (!(await until(() => link.status === "online" && !link.engine.runs))) throw new Error(`Pulse is ${link.status}`);
    const after = await tablet.next((m) => m.type === "session" && m.session?.epoch === epoch + 1, 5000);
    if (after?.session.presenting?.slide !== 2) throw new Error(JSON.stringify(after?.session));
    if (errors.length) throw new Error(errors.join("; "));
  });
} finally {
  await browser?.close();
  tablet.close();
  room.close();
  server.close();
  link.stop();
}

finish();
