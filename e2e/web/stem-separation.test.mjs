// Stem separation in the web app (issue #63), against a fake Demucs API
// (e2e/lib/fake-demucs.mjs): Admin > Stem separation set up and its
// connection tested; a user given the Stem separation role; on a song's Audio tab,
// "Separate into stems", the quick stems arriving as a multitrack named by
// its parts with its models and what the analysis found (issue #175), then
// the finer ones in their place; a recording made into it listed apart;
// separated again as 6 parts, replacing the first stems.
import { chromium } from "playwright";
import { API, WEB, api, call, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { FAKE_DEMUCS_KEY, FAKE_DEMUCS_URL, startFakeDemucs, toneWav } from "../lib/fake-demucs.mjs";

let page;
const step = stepper(() => page);
const demucs = await startFakeDemucs();
const admin = await user("Stems page admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const singer = await user("Stems page singer");

const song = await api(singer, "POST", "/song-versions", { title: `Split in the app ${stamp}`, language: "en", artists: ["Band"], content: "[G]Hello\n", contentFormat: "CHORDPRO" });
const form = new FormData();
form.append("type", "AUDIO");
form.append("file", new Blob([toneWav(300, 2)], { type: "audio/wav" }), "Full mix.wav");
await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${singer.bearer}` }, body: form });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await step("not set up, or not allowed: no button", async () => {
    await signIn(page, singer);
    await page.goto(`${WEB}/library/${song.id}?tab=audio`);
    await page.getByText("Full mix.wav").first().waitFor();
    await page.waitForTimeout(1000);
    if (await page.getByTestId("separate-stems").count()) throw new Error("offered before it's set up");
    await page.context().clearCookies();
  });

  await step("Admin > Stem separation: the server saved, its connection tested", async () => {
    await signIn(page, admin);
    await page.goto(`${WEB}/admin/stem-separation`);
    await page.getByRole("heading", { name: "Stem separation" }).waitFor();
    await page.getByTestId("stem-source").getByText("Nothing configured").waitFor();
    await page.getByLabel("API address").fill(FAKE_DEMUCS_URL);
    await page.getByLabel("API key").fill(FAKE_DEMUCS_KEY);
    await page.getByTestId("stem-save").click();
    await page.getByTestId("stem-source").getByText("saved in the database").waitFor();
    if ((await page.getByLabel("API key").inputValue()) !== "") throw new Error("the key shown back");
    await page.getByTestId("stem-test").click();
    await page.getByTestId("stem-test-result").getByText("htdemucs_6s").waitFor();
  });

  await step("Admin > Users: the Stem separation role given to them (issue #160)", async () => {
    await page.goto(`${WEB}/admin/users`);
    await page.getByPlaceholder("Search by name or email…").fill(singer.email);
    const row = page.getByRole("row").filter({ hasText: singer.email });
    await row.getByRole("button", { name: /Stems page singer/ }).click();
    await page.getByRole("menuitem", { name: "Roles…" }).click();
    await page.getByTestId("roles-dialog-list").getByLabel(/Stem separation/).check();
    await page.getByTestId("roles-dialog-save").click();
    await row.getByTestId("user-roles").getByText("Stem separation").waitFor();
    await page.context().clearCookies();
  });

  await step("Audio tab: separated into 4 parts, the quick stems as a multitrack named by its parts, with its models", async () => {
    demucs.analysis.next = {
      tempo: { bpm: 84, confidence: 0.9 },
      key: { name: "D", confidence: 0.8 },
      time_signature: { numerator: 3, denominator: 4, confidence: 0.55 },
      // What it nearly picked (Sonic 1.11, issue #452).
      alternatives: { time_signature: [{ numerator: 6, denominator: 8, score: 0.5 }], key: [{ name: "Bm", score: 0.4 }] },
    };
    await signIn(page, singer);
    await page.goto(`${WEB}/library/${song.id}?tab=audio`);
    await page.getByTestId("separate-stems").click();
    await page.getByTestId("separate-options").getByText("Only separate a recording you have the rights").waitFor();
    if (await page.getByTestId("separate-replace").count()) throw new Error("nothing to replace yet");
    await page.getByTestId("separate-start").click();
    await page.getByTestId("separations").getByText("Full mix.wav, 4 parts").waitFor();
    await page.getByTestId("separation-FAST_READY").getByText("a finer version is on its way").waitFor({ timeout: 30_000 });
    const box = page.locator('[data-testid="stems-recording"]').filter({ hasText: "Separated (4 parts)" });
    await box.getByTestId("multitrack-separation").getByText("Models: htdemucs → htdemucs_ft").waitFor({ timeout: 15_000 });
  });

  await step("what the analysis found, to check: how sure it is, and what else it might be (issues #175, #452)", async () => {
    const card = page.locator('[data-testid="stems-recording"]').filter({ hasText: "Separated (4 parts)" }).getByTestId("detected");
    await card.getByText("Check what Sonic found").waitFor();
    await card.getByTestId("check-key").getByText("D", { exact: true }).waitFor();
    await card.getByTestId("check-key").getByText("sure", { exact: false }).waitFor();
    await card.getByTestId("check-tempo").getByText("84 BPM").waitFor();
    await card.getByTestId("check-timeSignature").getByText("a guess").waitFor();
    await card.getByTestId("check-key").getByRole("button", { name: "Use Bm" }).waitFor();
  });

  await step("another time signature picked: Sonic listens again with it, and it's theirs", async () => {
    const card = page.locator('[data-testid="stems-recording"]').filter({ hasText: "Separated (4 parts)" }).getByTestId("detected");
    await card.getByTestId("check-timeSignature").getByRole("button", { name: "Use 6/8" }).click();
    await card.getByTestId("check-asking").getByText("Sonic is listening again with 6/8").waitFor();
    // Done: 6/8 is no longer a guess to check, and no new stems came.
    await card.getByTestId("check-timeSignature").waitFor({ state: "detached", timeout: 30_000 });
    await card.getByTestId("check-asking").waitFor({ state: "detached" });
    const sent = demucs.received.at(-1);
    if (sent.separate !== false || sent.hints?.time_signature !== "6/8") throw new Error(JSON.stringify(sent));
    if ((await page.locator('[data-testid="stems-recording"]').count()) !== 1) throw new Error("a second multitrack");
    if (await page.getByTestId("separations").getByText("Full mix.wav", { exact: false }).count() !== 1) throw new Error("listed as a separation");
  });

  await step("Looks right: confirmed", async () => {
    const box = page.locator('[data-testid="stems-recording"]').filter({ hasText: "Separated (4 parts)" });
    await box.getByTestId("confirm-detected").click();
    await box.getByTestId("detected").waitFor({ state: "detached" });
  });

  await step("the finer stems in their place: Ready, High quality", async () => {
    const jobId = sql(`select "jobId" from "StemSeparation" where "songVersionId"='${song.id}' and not "analysisOnly"`);
    await demucs.completeHq(jobId);
    // The page looks again every minute while only the finer stems are awaited.
    await page.getByTestId("separation-COMPLETED").getByText("Ready").waitFor({ timeout: 90_000 });
    await page.locator('[data-testid="stems-recording"]').filter({ hasText: "Separated (4 parts)" }).getByTestId("high-quality").waitFor();
  });

  await step("a recording made into it: under Recordings, apart from the stems", async () => {
    const multitrackId = sql(`select "multitrackId" from "StemSeparation" where "songVersionId"='${song.id}' and not "analysisOnly"`);
    const take = new FormData();
    take.append("type", "AUDIO");
    take.append("stemPart", "VOCALS");
    take.append("multitrackId", multitrackId);
    take.append("process", "encode");
    take.append("file", new Blob([toneWav(440, 2)], { type: "audio/wav" }), "My harmony.wav");
    await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${singer.bearer}` }, body: take });
    await page.reload();
    const recordings = page.locator('[data-testid="stems-recording"]').filter({ hasText: "Separated (4 parts)" }).getByTestId("multitrack-recordings");
    await recordings.getByText("My harmony").waitFor();
    await recordings.getByTestId("recorded-by").getByText("Recorded by Stems page singer").waitFor();
  });

  await step("separated again as 6 parts, replacing the earlier stems: no finer pass, the recording moved over", async () => {
    await page.getByTestId("separate-stems").click();
    await page.getByTestId("separate-parts-6").check();
    await page.getByTestId("separate-options").getByText("6 parts get no finer version").waitFor();
    if (!(await page.getByTestId("separate-replace").isChecked())) throw new Error("replace not offered, on");
    await page.getByTestId("separate-start").click();
    const box = page.locator('[data-testid="stems-recording"]').filter({ hasText: "Separated (6 parts)" });
    await box.getByTestId("multitrack-separation").getByText("Models: htdemucs_6s").waitFor({ timeout: 45_000 });
    await box.getByTestId("multitrack-recordings").getByText("My harmony").waitFor();
    if (await page.locator('[data-testid="stems-recording"]').filter({ hasText: "Separated (4 parts)" }).count()) throw new Error("the earlier stems are still here");
    if (demucs.received.at(-1).model !== "htdemucs_6s" || demucs.received.at(-1).hqEnabled) throw new Error(JSON.stringify(demucs.received.at(-1)));
  });
} finally {
  await call(admin, "DELETE", "/admin/stem-separation");
  await browser.close();
  await demucs.close();
}
finish();
