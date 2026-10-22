// What the slides say (issue #247, docs/live-session.md): "this item, slide N"
// goes with a key of the words the presenter cut the item into. A screen whose
// own slides differ (the item edited since it loaded it) loads it again; still
// different, it shows no words rather than another slide's.
import { chromium } from "playwright";
import { SCREEN, api, finish, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";
import { slideKey, textSlides } from "../../packages/core/dist/index.js";

let page;
const step = stepper(() => page);
const leader = await user("Slide keys");
const set = await api(leader, "POST", "/setlists", { name: `Slide keys ${stamp}` });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "Coffee after the service\n\nKids to the hall" } });
const item = items[0];
const keyOf = (body) => slideKey(textSlides({ title: "Notices", body }));

const browser = await chromium.launch();
let leading;
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  tv.on("pageerror", (error) => errors.push(error.message));
  const words = tv.getByTestId("screen-lines");

  await step("a screen on the set, shown the first slide with the words' key", async () => {
    page = tv;
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    await api(leader, "POST", `/screens/pairings/${code}/confirm`, { name: `Hall ${stamp}`, mode: "LYRICS", setlistId: set.id });
    await tv.locator('[data-testid="screen-display"][data-state="showing"]').waitFor({ timeout: 15000 });
    leading = await syncDevice(leader);
    leading.send({ type: "join", setId: set.id });
    await leading.next((m) => m.type === "session");
    leading.send({ type: "lead" });
    await leading.next((m) => m.type === "session" && m.leading);
    leading.send({ type: "present", presenting: { itemId: item.id, slide: 0, black: false, slideKey: keyOf("Coffee after the service\n\nKids to the hall") }, basedOn: 0 });
    await words.getByText("Coffee after the service").waitFor({ timeout: 10000 });
  });

  await step("edited since the screen loaded it: the screen loads it again and shows the new words", async () => {
    const body = "Tea after the service\n\nKids to the hall";
    await api(leader, "PATCH", `/setlists/${set.id}/items/${item.id}`, { text: { title: "Notices", body } });
    leading.send({ type: "present", presenting: { itemId: item.id, slide: 0, black: false, slideKey: keyOf(body) }, basedOn: 1 });
    await words.getByText("Tea after the service").waitFor({ timeout: 10000 });
  });

  await step("words the screen can't get: no words rather than the wrong ones, and back when they match", async () => {
    leading.send({ type: "present", presenting: { itemId: item.id, slide: 1, black: false, slideKey: keyOf("Something else entirely") }, basedOn: 2 });
    await tv.locator(`[data-testid="screen-showing"][data-slide="1"]`).waitFor({ timeout: 10000 });
    await tv.waitForFunction(() => !document.body.innerText.includes("Kids to the hall"), null, { timeout: 10000 });
    leading.send({ type: "present", presenting: { itemId: item.id, slide: 1, black: false, slideKey: keyOf("Tea after the service\n\nKids to the hall") }, basedOn: 3 });
    await words.getByText("Kids to the hall").waitFor({ timeout: 10000 });
  });

  await step("a presenter that sends no key (an older client): the words, as before", async () => {
    leading.send({ type: "present", presenting: { itemId: item.id, slide: 0, black: false }, basedOn: 4 });
    await words.getByText("Tea after the service").waitFor({ timeout: 10000 });
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  leading?.close();
  await browser.close();
}

finish();
