// What a version plays along to (issue #346): a song has several reference recordings, each its adder's and shown to
// whom they choose, as files are; a version picks one, and one of the song's multitracks. A set playing the song in
// that version plays its multitrack (after one recorded for the set) and shows its recording.
import { chromium } from "playwright";
import { API, WEB, api, call, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Version media");
const other = await user("Version media other");

function wav(frequency, seconds = 2, rate = 8000) {
  const samples = seconds * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 3000), 44 + i * 2);
  return buffer;
}

const song = await api(me, "POST", "/song-versions", {
  title: `Media ${stamp}`,
  language: "en",
  artists: ["Someone"],
  content: "{start_of_verse}\n[G]Words here\n{end_of_verse}\n",
  contentFormat: "CHORDPRO",
});

async function upload(fields, name) {
  const form = new FormData();
  form.append("type", "AUDIO");
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  form.append("file", new Blob([wav(220)], { type: "audio/wav" }), name);
  const res = await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
  if (res.status !== 201) throw new Error(`${res.status} ${await res.text()}`);
}
// The song's own stems, and an acoustic multitrack.
await upload({ stemPart: "GUITAR" }, "Guitar.wav");
await upload({ stemPart: "VOCALS" }, "Vocals.wav");
await upload({ stemPart: "GUITAR", multitrackId: "mtacoustic001", multitrackName: "Acoustic" }, "Acoustic guitar.wav");
await upload({ stemPart: "VOCALS", multitrackId: "mtacoustic001", multitrackName: "Acoustic" }, "Acoustic vocals.wav");

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);

let link;
await step("API: a YouTube address is read for its video and start; private to its adder; refused when not an address", async () => {
  const bad = await call(me, "POST", `/song-versions/${song.id}/references`, { url: "not a link", label: "Nope" });
  if (bad.status !== 400) throw new Error(`${bad.status} ${JSON.stringify(bad.body)}`);
  link = await api(me, "POST", `/song-versions/${song.id}/references`, { url: "https://youtu.be/abcDEF12345?t=1m5s", label: "Live 2019" });
  if (link.service !== "YOUTUBE" || link.value !== "abcDEF12345" || link.startSeconds !== 65 || link.visibility !== "PRIVATE") throw new Error(JSON.stringify(link));
  // Someone who can't see the song can't list them; one who could still wouldn't see a private one (checked below with the share).
  const hidden = await call(other, "GET", `/song-versions/${song.id}/references`);
  if (hidden.status !== 403 && hidden.status !== 404) throw new Error(`${hidden.status}`);
  const forEveryone = await call(other, "POST", `/song-versions/${song.id}/references`, { url: "https://vimeo.com/1", label: "x", visibility: "SONG" });
  if (forEveryone.status !== 403 && forEveryone.status !== 404) throw new Error(`${forEveryone.status}`);
});

await step("the Links tab: Reference recordings lists it, and adds another (any address)", async () => {
  await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "Links" }).click();
  const card = page.getByTestId("reference-recordings");
  await card.getByRole("link", { name: "Live 2019" }).waitFor();
  await card.getByText("YouTube · from 1:05").waitFor();
  await card.getByLabel("Address").fill("https://www.deezer.com/fr/track/3135556");
  await card.getByLabel("Name").fill("Studio");
  await card.getByRole("button", { name: "Add recording" }).click();
  await card.getByRole("link", { name: "Studio" }).waitFor();
  const links = await api(me, "GET", `/song-versions/${song.id}/references`);
  if (links.length !== 2 || links[1].service !== "DEEZER" || links[1].value !== "3135556") throw new Error(JSON.stringify(links));
});

let version;
await step("the version editor: Reference recording and Stems, saved with the version", async () => {
  version = await api(me, "POST", `/song-versions/${song.id}/arrangements`, { name: "Sunday" });
  await page.goto(`${WEB}/library/${song.id}/arrangements/${version.id}`);
  await page.getByLabel("Reference recording").selectOption({ label: "Studio" });
  await page.getByLabel("Stems").selectOption({ label: "Acoustic" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved").first().waitFor();
  const saved = await api(me, "GET", `/arrangements/${version.id}`);
  const studio = (await api(me, "GET", `/song-versions/${song.id}/references`)).find((one) => one.label === "Studio");
  if (saved.linkId !== studio.id || saved.multitrackId !== "mtacoustic001") throw new Error(JSON.stringify({ linkId: saved.linkId, multitrackId: saved.multitrackId }));
  // Not another song's recording, nor a multitrack the song hasn't.
  const wrong = await call(me, "PATCH", `/arrangements/${version.id}`, { multitrackId: "mtnotthere01" });
  if (wrong.status !== 400) throw new Error(`${wrong.status}`);
});

await step("a set playing it in that version: its multitrack plays, its recording shows; as written, the song's own", async () => {
  const set = await api(me, "POST", "/setlists", { name: `Media set ${stamp}` });
  const detail = await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
  const item = detail.items[0];
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/sets/${set.id}/songs/${item.id}`);
  await page.getByTestId("stem-player").waitFor();
  if ((await page.getByTestId("stem-multitrack").inputValue()) !== "") throw new Error("as written, not the song's own stems");
  if (await page.getByTestId("version-reference").count()) throw new Error("a reference shown as written");

  await api(me, "PATCH", `/setlists/${set.id}/items/${item.id}`, { arrangementId: version.id });
  await page.reload();
  await page.getByTestId("version-reference").filter({ hasText: "Reference: Studio" }).waitFor();
  if ((await page.getByTestId("version-reference").getAttribute("href")) !== "https://www.deezer.com/track/3135556") throw new Error("not the recording's address");
  await page.getByTestId("stem-player").waitFor();
  for (let i = 0; i < 40 && (await page.getByTestId("stem-multitrack").inputValue()) !== "mtacoustic001"; i++) await page.waitForTimeout(100);
  if ((await page.getByTestId("stem-multitrack").inputValue()) !== "mtacoustic001") throw new Error(await page.getByTestId("stem-multitrack").inputValue());
});

await step("removing the recording: the version goes back to the song's own", async () => {
  const studio = (await api(me, "GET", `/song-versions/${song.id}/references`)).find((one) => one.label === "Studio");
  const res = await call(me, "DELETE", `/song-versions/${song.id}/references/${studio.id}`);
  if (res.status !== 204) throw new Error(`${res.status}`);
  const saved = await api(me, "GET", `/arrangements/${version.id}`);
  if (saved.linkId !== null) throw new Error(saved.linkId);
});

await browser.close();
finish();
