// The screen app (issue #305), screen.oneverse.top: a big screen opens it
// with no sign-in and shows a code and a QR code that opens Songverse's
// Screens page; paired there, it claims its token and shows what's presented
// on the set - songs and texts, over the API (CORS lets it in) and /sync.
// `?theme=` pins a built-in theme on this device. Songverse's /screen sends a
// screen there, paired as it was.
import { chromium } from "playwright";
import { SCREEN, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const leader = await user("Screen app");
const set = await api(leader, "POST", "/setlists", { name: `On the big screen ${stamp}` });
const song = await api(leader, "POST", "/song-versions", { title: `Big screen ${stamp}`, language: "en", artists: ["Band"], content: "{start_of_verse}\nFirst line on the wall\nsecond line\n{end_of_verse}\n", contentFormat: "CHORDPRO" });
await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Welcome", body: "Welcome, everyone" } });
const [songItem, textItem] = items;

const browser = await chromium.launch();
let leading;
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const phone = await (await browser.newContext({ viewport: { width: 400, height: 800 } })).newPage();
  const errors = [];
  for (const one of [tv, phone]) one.on("pageerror", (error) => errors.push(error.message));
  let code;

  await step("the screen app, signed in nowhere: a code, and a QR code to Songverse's Screens", async () => {
    page = tv;
    await tv.goto(SCREEN);
    await tv.getByTestId("screen-pairing").waitFor();
    code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error(code);
    const link = await tv.getByTestId("screen-qr").getAttribute("data-link");
    if (link !== `${WEB}/screens?code=${code}`) throw new Error(link);
    await tv.getByText(`go to ${new URL(WEB).host}/screens`).waitFor();
  });

  await step("paired from the QR code's link in Songverse, it shows the set", async () => {
    page = phone;
    await signIn(phone, leader);
    await phone.goto(`${WEB}/screens?code=${code}&setlistId=${set.id}`);
    // Hydrated before the form is used: a fresh server's first page is slow.
    await phone.waitForLoadState("networkidle");
    await phone.getByLabel("Name").first().fill("Wall");
    await phone.getByTestId("screen-pair-form").getByRole("button", { name: "Pair screen" }).click();
    await phone.getByTestId("screens-list").getByTestId("screen-Wall").waitFor();
    page = tv;
    await tv.locator('[data-testid="screen-display"][data-state="showing"]').waitFor({ timeout: 15000 });
    await tv.getByTestId("screen-idle").getByText(`On the big screen ${stamp}`).waitFor();
  });

  await step("presented: a song's words, then a text's", async () => {
    leading = await syncDevice(leader);
    leading.send({ type: "join", setId: set.id });
    await leading.next((m) => m.type === "session");
    leading.send({ type: "lead" });
    await leading.next((m) => m.type === "session" && m.leading);
    leading.send({ type: "update", presenting: { itemId: songItem.id, slide: 0, black: false } });
    await tv.getByTestId("screen-lines").getByText("First line on the wall").waitFor({ timeout: 10000 });
    leading.send({ type: "update", presenting: { itemId: textItem.id, slide: 0, black: false } });
    await tv.getByTestId("screen-lines").getByText("Welcome, everyone").waitFor({ timeout: 10000 });
  });

  await step("kept paired across a reload; ?theme= pins a built-in theme", async () => {
    await tv.goto(`${SCREEN}/?theme=concert`);
    await tv.locator('[data-testid="screen-showing"][data-theme]').waitFor({ timeout: 15000 });
    await tv.getByTestId("screen-lines").getByText("Welcome, everyone").waitFor({ timeout: 10000 });
  });

  await step("a screen paired at Songverse's /screen before: sent to the screen app, still paired, the token out of the address", async () => {
    const token = await tv.evaluate(() => localStorage.getItem("songverse.screen.token"));
    // Paired before: Songverse's own storage had the token.
    const fresh = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    fresh.on("pageerror", (error) => errors.push(error.message));
    page = fresh;
    await fresh.goto(`${WEB}/manifest.webmanifest`);
    await fresh.evaluate((value) => localStorage.setItem("songverse.screen.token", value), token);
    await fresh.goto(`${WEB}/screen?theme=concert`);
    await fresh.waitForURL(`${SCREEN}/**`);
    await fresh.locator('[data-testid="screen-showing"][data-theme]').waitFor({ timeout: 15000 });
    await fresh.getByTestId("screen-lines").getByText("Welcome, everyone").waitFor({ timeout: 10000 });
    if (fresh.url() !== `${SCREEN}/?theme=concert`) throw new Error(fresh.url());
    if ((await fresh.evaluate(() => localStorage.getItem("songverse.screen.token"))) !== token) throw new Error("the token wasn't kept");
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  leading?.close();
  await browser.close();
}
finish();
