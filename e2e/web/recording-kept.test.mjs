// Takes are never lost (issue #365): a take is written to the device as
// it's recorded and kept there until the upload has answered. Without a
// connection it waits under "Takes on this device" (through a reload) and
// goes on its own when the connection is back; one cut short by a reload
// mid-take is there to keep or discard. Chromium's fake microphone records.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Keeper");
const song = await api(me, "POST", "/song-versions", { title: `Kept ${stamp}`, language: "en", artists: [`Band ${stamp}`], content: "[G]Hello [C]world\n", contentFormat: "CHORDPRO", tempo: 120, timeSignature: "4/4" });
const files = () => api(me, "GET", `/song-versions/${song.id}/attachments`);

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await signIn(page, me);
const dialog = () => page.getByTestId("recorder");
const stored = () => page.getByTestId("stored-take");

/** Uploads of audio fail as with no connection, until `online()`. */
const uploads = "**/song-versions/*/attachments";
const offline = () => page.route(uploads, (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.fallback()));
const online = () => page.unroute(uploads);

/** Opens the recorder for a new multitrack and records about `seconds` past the count-in. */
async function record(seconds) {
  await page.getByTestId("record-new").click();
  await page.locator('[data-testid="recorder"][data-phase="ready"]').waitFor({ timeout: 15000 });
  await dialog().getByTestId("recorder-start").click();
  await dialog().getByText(/Recording 0:0[0-9]/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(seconds * 1000);
}

async function openAudio() {
  await page.goto(`${WEB}/library/${song.id}?tab=audio`);
  await page.waitForLoadState("networkidle");
}

await step("no connection when it's kept: it says so, and the take waits on the device", async () => {
  await openAudio();
  await record(1.5);
  await dialog().getByTestId("recorder-stop").click();
  await offline();
  await dialog().getByTestId("recorder-keep").click();
  await dialog().getByTestId("recorder-waiting").getByText("Kept on this device").waitFor({ timeout: 15000 });
  await dialog().getByTestId("recorder-close").click();
  await page.getByTestId("stored-takes").getByText("1 take on this device").waitFor();
  await page.locator('[data-testid="stored-take"][data-state="waiting"]').waitFor();
  if ((await files()).length !== 0) throw new Error("uploaded");
});

await step("it's still there after a reload, and Upload now sends it", async () => {
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="stored-take"][data-state="waiting"]').waitFor();
  await page.getByTestId("stored-take").getByText("waiting to upload").waitFor();
  await online();
  await page.getByTestId("stored-take-upload").click();
  await page.getByTestId("stored-takes").waitFor({ state: "detached", timeout: 15000 });
  const all = await files();
  if (all.length !== 1 || all[0].origin !== "RECORDED" || !all[0].multitrackId) throw new Error(JSON.stringify(all));
});

await step("when the connection comes back, a take waiting goes on its own", async () => {
  await record(1);
  await dialog().getByTestId("recorder-stop").click();
  await offline();
  await dialog().getByTestId("recorder-keep").click();
  await dialog().getByTestId("recorder-waiting").waitFor({ timeout: 15000 });
  await dialog().getByTestId("recorder-close").click();
  await page.getByTestId("stored-takes").waitFor();
  await online();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByTestId("stored-takes").waitFor({ state: "detached", timeout: 15000 });
  if ((await files()).length !== 2) throw new Error("not sent");
});

await step("a reload in the middle of a take: what was recorded is on the device, to keep", async () => {
  await record(3);
  // Written a couple of seconds at a time: some of it is on the device already.
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("songverse-takes");
        req.onsuccess = () => {
          const count = req.result.transaction("chunks").objectStore("chunks").count();
          count.onsuccess = () => resolve(count.result > 0);
          count.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      }),
    null,
    { timeout: 10000 },
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
  const cut = page.locator('[data-testid="stored-take"][data-state="recording"]');
  await cut.waitFor();
  await cut.getByText("cut short").waitFor();
  // Heard first (made into a file to play: it's then waiting like any other), then kept - beside the other takes, never instead of one.
  await cut.getByRole("button", { name: "Listen" }).click();
  const take = page.getByTestId("stored-take");
  await take.getByRole("button", { name: "Pause" }).waitFor();
  await page.locator('[data-testid="stored-take"][data-state="waiting"]').waitFor();
  await take.getByTestId("stored-take-upload").click();
  await page.getByTestId("stored-takes").waitFor({ state: "detached", timeout: 15000 });
  const all = await files();
  if (all.length !== 3) throw new Error(JSON.stringify(all.map((file) => file.filename)));
});

await step("one cut short can be discarded instead", async () => {
  await record(3);
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const cut = page.locator('[data-testid="stored-take"][data-state="recording"]');
  await cut.waitFor();
  await cut.getByRole("button", { name: "Discard" }).click();
  await cut.getByRole("button", { name: "Discard this take" }).click();
  await page.getByTestId("stored-takes").waitFor({ state: "detached" });
  if ((await files()).length !== 3) throw new Error("uploaded");
});

await step("a take recorded and not kept leaves nothing on the device", async () => {
  await record(1);
  await dialog().getByTestId("recorder-stop").click();
  await page.keyboard.press("Escape");
  await dialog().waitFor({ state: "detached" });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("record-new").waitFor();
  await page.waitForTimeout(500);
  if ((await stored().count()) !== 0) throw new Error("kept");
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join("\n"));
});

await browser.close();
finish();
