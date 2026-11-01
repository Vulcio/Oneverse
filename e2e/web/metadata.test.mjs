// Metadata providers in the browser (issue #22): Auto detect's matches from
// MusicBrainz, Apple Music and Deezer (stand-ins, lib/fake-providers.mjs),
// the song's first release first; choosing one shows what it fills in
// (issue #352: the empty fields ticked, what the song has only if ticked)
// and, once saved, links the song to its sources and brings its Deezer
// link; adding a song, the search runs by itself;
// the admin's providers card - order, what each is asked for (issue #89) -
// and in it the Apple Music API's key (issue #87) and Spotify's app.
import { chromium } from "playwright";
import { generateKeyPairSync } from "node:crypto";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { FAKE_PROVIDERS_URL, appleMusicKey, spotifyApp, startFakeProviders } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();
let page;
const step = stepper(() => page);
const me = await user("Seeker");
sql(`update "User" set "isGlobalAdmin"=true where id='${me.id}'`);
await api(me, "DELETE", "/admin/metadata");
await api(me, "DELETE", "/admin/metadata/apple-music");
await api(me, "DELETE", "/admin/metadata/spotify");
const title = `Oceans ${stamp}`;
const song = await api(me, "POST", "/song-versions", { title, language: "en", artists: ["Hillsong"] });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);

await step("Auto detect: one match per release, the first release first, from all three", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  await page.getByRole("button", { name: "Find song info" }).click();
  const matches = page.getByTestId("metadata-matches").getByRole("listitem");
  await matches.first().waitFor();
  const first = matches.first();
  await first.getByText("Hillsong · Album 1 · 2013").waitFor();
  await first.getByTestId("match-sources").getByText("MusicBrainz · Apple Music · Deezer").waitFor();
  const second = await matches.nth(1).innerText();
  if (!second.includes("Album 2 · 2016")) throw new Error(`second: ${second}`);
});

await step("chosen: its review, the empty fields ticked", async () => {
  await page.getByTestId("metadata-matches").getByRole("listitem").first().getByRole("button", { name: "Use this" }).click();
  const review = page.getByTestId("song-info-review");
  await review.getByText("What this match fills in").waitFor();
  const row = (field) => review.locator(`[data-field="${field}"]`);
  // The same artist isn't offered again; Deezer's tempo, rounded, and the length are.
  if (await row("artists").count()) throw new Error("the artist it has is offered again");
  await row("tempo").getByText("124", { exact: true }).waitFor();
  await row("duration").getByText("4:13", { exact: true }).waitFor();
  for (const field of ["album", "year", "tempo", "duration"]) if (!(await row(field).getByRole("checkbox").isChecked())) throw new Error(`${field} isn't ticked`);
  // The song has its own image (found when it was made): kept unless ticked.
  if (await row("artwork").count()) {
    if (await row("artwork").getByRole("checkbox").isChecked()) throw new Error("its own image would be replaced");
    await row("artwork").getByText("Now: its own image").waitFor();
  }
  await row("duration").getByRole("checkbox").uncheck();
  await review.getByRole("button", { name: "Use selected" }).click();
});

await step("used: the album, year and tempo filled in, and linked once saved", async () => {
  await page.getByText("The link is saved with the song", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Save song" }).click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  for (const name of ["MusicBrainz", "Apple Music", "Deezer"]) await page.getByRole("link", { name, exact: true }).waitFor();
  const linked = await api(me, "GET", `/song-versions/${song.id}/metadata`);
  if (linked?.album !== "Album 1") throw new Error(JSON.stringify(linked));
  const saved = await api(me, "GET", `/song-versions/${song.id}`);
  if (saved.album !== "Album 1" || saved.year !== 2013) throw new Error(`album ${saved.album}, year ${saved.year}`);
  if (saved.documentJson.defaults.tempo !== 124 || saved.documentJson.defaults.durationSeconds) throw new Error(JSON.stringify(saved.documentJson.defaults));
});

await step("its Deezer track on Links", async () => {
  await page.getByRole("tab", { name: "Links" }).click();
  await page.getByLabel("Deezer", { exact: true }).waitFor();
  const value = await page.getByLabel("Deezer", { exact: true }).inputValue();
  if (!value.includes("deezer.com/track/5001")) throw new Error(`Deezer link: ${value}`);
});

await step("adding a song: the search runs by itself, Use all", async () => {
  await page.goto(`${WEB}/library/new`);
  await page.getByLabel("Song name").fill(`Cornerstone ${stamp}`);
  await page.getByText("Found online for this name", { exact: false }).waitFor({ timeout: 15000 });
  // No artist typed: every band's song with that name, the oldest first; the one on Album 1 chosen.
  await page.getByTestId("metadata-matches").getByRole("listitem").filter({ hasText: "Album 1" }).first().getByRole("button", { name: "Use this" }).click();
  const review = page.getByTestId("song-info-review");
  await review.getByRole("button", { name: "Use all" }).click();
  await page.getByText("The link is saved with the song", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Save song" }).click();
  await page.waitForURL(/\/library\/(?!new)/);
  const id = page.url().split("/library/")[1].split(/[?#]/)[0];
  const saved = await api(me, "GET", `/song-versions/${id}`);
  if (saved.album !== "Album 1" || saved.documentJson.defaults.tempo !== 124 || !saved.artists?.length) throw new Error(`${saved.album} ${JSON.stringify(saved.documentJson.defaults)} ${JSON.stringify(saved.artists)}`);
});

await step("the admin's providers: reordered, one off, reverted", async () => {
  await page.goto(`${WEB}/admin/metadata`);
  const card = page.getByTestId("metadata-providers");
  await card.getByText("Currently using: the defaults").waitFor();
  await card.getByRole("button", { name: "Move Deezer up" }).click();
  await card.getByRole("button", { name: "Move Deezer up" }).click();
  await card.getByLabel("Song info from MusicBrainz").uncheck();
  await card.getByLabel("Album artwork from Deezer").uncheck();
  // What a provider can't do isn't offered.
  if (await card.getByLabel("Album artwork from MusicBrainz").count()) throw new Error("MusicBrainz offered for artwork");
  await card.getByTestId("provider-spotify").getByText("(needs a key)").first().waitFor();
  await card.getByRole("button", { name: "Save configuration" }).click();
  await card.getByText("Currently using: settings saved here.").waitFor();
  const settings = await api(me, "GET", "/admin/metadata");
  const order = settings.providers.map((p) => `${p.key}:${p.capabilities.songInfo}:${p.capabilities.artwork}`).join();
  if (order !== "deezer:true:false,musicbrainz:false:false,apple_music:true:true,spotify:true:true,song_providers:true:true") throw new Error(order);
  await card.getByRole("button", { name: "Revert to environment variables" }).click();
  await card.getByRole("button", { name: "Revert", exact: true }).click();
  await card.getByText("Currently using: the defaults").waitFor();
});

await step("the Apple Music API's key: saved, tested, reverted", async () => {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  Object.assign(appleMusicKey, { publicKey: pair.publicKey, teamId: "TEAM123456", keyId: "KEY1234567" });
  await page.getByRole("button", { name: "Apple Music settings" }).click();
  const card = page.getByTestId("apple-music-key");
  await card.getByText("Currently using: no key - iTunes Search.").waitFor();
  await card.getByLabel("Team ID").fill("TEAM123456");
  await card.getByLabel("Key ID").fill("KEY1234567");
  await card.getByLabel("Private key (.p8)").fill(pair.privateKey.export({ type: "pkcs8", format: "pem" }));
  await card.getByRole("button", { name: "Save configuration" }).click();
  await card.getByText("Currently using: the key saved here (team TEAM123456, key KEY1234567).").waitFor();
  if ((await card.getByLabel("Private key (.p8)").inputValue()) !== "") throw new Error("the private key is still shown");
  await card.getByPlaceholder("Leave blank to keep the current one").waitFor();
  await card.getByRole("button", { name: "Test connection" }).click();
  await card.getByText("The Apple Music API answered", { exact: false }).waitFor();
  await card.getByRole("button", { name: "Revert to environment variables" }).click();
  await card.getByRole("button", { name: "Revert", exact: true }).click();
  await card.getByText("Currently using: no key - iTunes Search.").waitFor();
});

await step("a developer token address, until there's a key", async () => {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  Object.assign(appleMusicKey, { publicKey: pair.publicKey, privateKey: pair.privateKey, teamId: "MINT123456", keyId: "MINTKEY123" });
  const card = page.getByTestId("apple-music-key");
  await card.getByLabel("Developer token URL (without a key)").fill(`${FAKE_PROVIDERS_URL}/applemusic-token`);
  await card.getByRole("button", { name: "Save configuration" }).click();
  await card.getByText(`Currently using: developer tokens from ${FAKE_PROVIDERS_URL}/applemusic-token`, { exact: false }).waitFor();
  await card.getByRole("button", { name: "Test connection" }).click();
  await card.getByText("The Apple Music API answered", { exact: false }).waitFor();
  await card.getByRole("button", { name: "Revert to environment variables" }).click();
  await card.getByRole("button", { name: "Revert", exact: true }).click();
  await card.getByText("Currently using: no key - iTunes Search.").waitFor();
});

await step("Spotify's app: saved, tested, reverted", async () => {
  Object.assign(spotifyApp, { clientId: "abcdef0123456789abcdef0123456789", clientSecret: "s3cr3t-spotify" });
  await page.getByRole("button", { name: "Spotify settings" }).click();
  const card = page.getByTestId("spotify-settings");
  await card.getByText("Currently using: no app - Spotify isn't asked.").waitFor();
  await card.getByLabel("Client ID").fill(spotifyApp.clientId);
  await card.getByLabel("Client secret").fill(spotifyApp.clientSecret);
  await card.getByRole("button", { name: "Save configuration" }).click();
  await card.getByText(`Currently using: the app saved here (${spotifyApp.clientId}).`).waitFor();
  if ((await card.getByLabel("Client secret").inputValue()) !== "") throw new Error("the secret is still shown");
  // Ready now: no "needs a key" beside Spotify.
  if (await page.getByTestId("provider-spotify").getByText("(needs a key)").count()) throw new Error("still needs a key");
  await card.getByRole("button", { name: "Test connection" }).click();
  await card.getByText("Spotify answered", { exact: false }).waitFor();
  await card.getByRole("button", { name: "Revert to environment variables" }).click();
  await card.getByRole("button", { name: "Revert", exact: true }).click();
  await card.getByText("Currently using: no app - Spotify isn't asked.").waitFor();
});

await browser.close();
fake.close();
finish();
