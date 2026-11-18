// A song's links searched for from its Links tab (issue #169): the search
// button beside a service, a few results, the one picked saved as the link;
// without its key, YouTube's search shows dimmed and says why (issue #518).
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { startFakeProviders, youtubeKey } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();
let page;
const step = stepper(() => page);
const me = await user("Link picker");
const admin = await user("Link picker admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await api(admin, "DELETE", "/admin/metadata/youtube");
const song = await api(me, "POST", "/song-versions", { title: `Oceans ${stamp}`, language: "en", artists: ["Hillsong"] });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, me);

  await step("Links: a search beside Deezer; YouTube's, without its key, says one is needed", async () => {
    await page.goto(`${WEB}/library/${song.id}?tab=links`);
    await page.getByTestId("link-DEEZER-search").waitFor();
    if (await page.getByTestId("link-YOUTUBE-search").count()) throw new Error("a YouTube search without a key");
    await page.getByTestId("link-YOUTUBE-search-unavailable").click();
    await page.getByTestId("link-YOUTUBE-search-hint").getByText("YouTube can't be searched yet: an admin adds its key in Admin > Metadata.").waitFor();
  });

  await step("searched at Deezer, a result picked: it's the song's link", async () => {
    await page.getByTestId("link-DEEZER-search").click();
    const results = page.getByTestId("link-DEEZER-results");
    await results.getByRole("button").first().click();
    await results.waitFor({ state: "detached" });
    await page.waitForFunction(() => /deezer\.com\/track\/\d+/.test(document.querySelector("#link-DEEZER")?.value ?? ""));
    const saved = (await api(me, "GET", `/song-versions/${song.id}`)).identifiers.find((i) => i.type === "DEEZER");
    if (!saved) throw new Error("not saved");
  });

  await step("with YouTube's key: its search too", async () => {
    youtubeKey.key = "AIzaFakeYouTubeKey0123456789abcdefghijk";
    await api(admin, "PUT", "/admin/metadata/youtube", { apiKey: youtubeKey.key });
    await page.reload();
    await page.getByTestId("link-YOUTUBE-search").click();
    await page.getByTestId("link-YOUTUBE-results").getByText("Channel 2").click();
    await page.waitForFunction(() => document.querySelector("#link-YOUTUBE")?.value === "https://www.youtube.com/watch?v=ytvideo0002");
  });
} finally {
  await api(admin, "DELETE", "/admin/metadata/youtube");
  await browser.close();
  fake.close();
}
finish();
