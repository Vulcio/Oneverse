// A slide changed on a weak connection (issue #247, docs/live-session.md): a
// phone's socket that looks open but no longer reaches the server. The slide
// asked for stays on Live, marked as sending, rather than jumping back when the
// session comes round; once the connection is back it goes again, and the
// screens move.
import { chromium } from "playwright";
import { WEB, finish, signIn, stamp, stepper, user, api } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const singer = await user("Weak signal");
const set = await api(singer, "POST", `/setlists`, { name: `Weak signal ${stamp}` });
const { items } = await api(singer, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo\n\nThree" } });
const itemId = items[0].id;

const browser = await chromium.launch();
// While on, what Live sends never reaches the server; what the server sends still arrives.
const cut = { on: false };
let socket = null;
let watcher;
let other;
try {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await context.routeWebSocket(/\/sync$/, (ws) => {
    const server = ws.connectToServer();
    socket = { ws, server };
    ws.onMessage((message) => {
      if (!cut.on) server.send(message);
    });
  });
  const tablet = await context.newPage();
  const errors = [];
  tablet.on("pageerror", (error) => errors.push(error.message));
  const panel = (attributes) => tablet.locator(`[data-testid="present-panel"]${attributes}`);

  await step("Live leads the set and presents its first slide", async () => {
    page = tablet;
    await signIn(tablet, singer);
    await tablet.evaluate(() => localStorage.setItem("songverse.mode", "live"));
    await tablet.goto(`${WEB}/sets/${set.id}/live/${itemId}`);
    const control = tablet.getByTestId("sync-control").first();
    await control.click();
    await tablet.getByTestId("sync-menu").getByRole("menuitem", { name: "Turn sync on" }).click();
    await tablet.locator('[data-testid="sync-control"][data-state-sync="on"]').first().waitFor();
    await control.click();
    await tablet.getByTestId("sync-menu").getByRole("menuitem", { name: "Lead the set" }).click();
    await tablet.locator('[data-testid="sync-control"][data-state-sync="leading"]').first().waitFor();
    await control.click();
    await tablet.getByTestId("sync-present").click();
    await panel('[data-slide="0"][data-sending="false"]').waitFor();
    watcher = await syncDevice(singer);
    watcher.send({ type: "join", setId: set.id });
    await watcher.next((m) => m.type === "session" && m.session?.presenting?.slide === 0);
  });

  await step("Next with the connection gone quiet: the slide stays, marked as sending, the screens wait", async () => {
    cut.on = true;
    watcher.drain();
    await tablet.getByTestId("present-next").click();
    await panel('[data-slide="1"][data-sending="true"]').waitFor();
    await tablet.getByTestId("present-sending").waitFor();
    const moved = await watcher.next((m) => m.type === "session" && m.session?.presenting?.slide === 1, 1500);
    if (moved) throw new Error("the slide reached the server through a cut connection");
  });

  await step("the session comes round meanwhile (someone joins): Live doesn't jump back", async () => {
    other = await syncDevice(singer);
    other.send({ type: "join", setId: set.id });
    await other.next((m) => m.type === "session");
    await watcher.next((m) => m.type === "session" && m.members.length >= 3, 5000);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await panel('[data-slide="1"][data-sending="true"]').waitFor({ timeout: 1000 });
  });

  await step("the connection back: the slide goes again, the screens move, nothing's left to send", async () => {
    cut.on = false;
    socket.ws.close();
    socket.server.close();
    const moved = await watcher.next((m) => m.type === "session" && m.session?.presenting?.slide === 1, 15000);
    if (!moved) throw new Error("the slide wasn't sent again");
    await panel('[data-slide="1"][data-sending="false"]').waitFor({ timeout: 10000 });
    await tablet.getByTestId("present-next").click();
    await watcher.next((m) => m.type === "session" && m.session?.presenting?.slide === 2, 5000);
    await panel('[data-slide="2"][data-sending="false"]').waitFor();
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  watcher?.close();
  other?.close();
  await browser.close();
}

finish();
