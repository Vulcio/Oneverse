// Teams' and songbooks' colour and picture in the app (issue #161): the
// team page's Colour and picture card, for its admin; the sidebar showing
// the colour, then the picture; a songbook's, from its details.
import { chromium } from "playwright";
import sharp from "sharp";
import { WEB, api, call, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Looks page");
const team = await api(me, "POST", "/teams", { name: `Looks page band ${stamp}` });
const book = await api(me, "POST", "/songbooks", { name: `Looks page book ${stamp}`, kind: "SIMPLE" });
const png = await sharp({ create: { width: 240, height: 160, channels: 3, background: { r: 30, g: 160, b: 90 } } }).png().toBuffer();

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, me);

  await step("a team's colour picked on its page, and shown in the sidebar", async () => {
    await page.goto(`${WEB}/teams/${team.id}`);
    // Often the part's first page: clicked once it has hydrated.
    await page.waitForLoadState("networkidle");
    const card = page.getByTestId("appearance");
    await card.getByText("Colour and picture").waitFor();
    await card.getByTestId("appearance-color-violet").click();
    await card.locator('[role="radio"][aria-label="Violet"][aria-checked="true"]').waitFor();
    await page.locator(`a[href="/teams/${team.id}"] [data-color="violet"]`).first().waitFor();
  });

  await step("its picture, in place of its initials", async () => {
    await page.getByTestId("appearance").getByTestId("appearance-picture-input").setInputFiles({ name: "band.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Remove the picture" }).waitFor();
    await page.waitForFunction((id) => [...document.querySelectorAll(`a[href="/teams/${id}"] img`)].some((img) => img.src.includes(`/teams/${id}/avatar/`) && img.complete && img.naturalWidth > 0), team.id);
  });

  await step("a songbook's, from its details", async () => {
    await page.goto(`${WEB}/songbooks/${book.id}`);
    await page.getByTestId("songbook-details-toggle").click();
    await page.getByTestId("appearance").getByTestId("appearance-color-amber").click();
    await page.locator('h1').locator("..").locator('[data-color="amber"]').waitFor();
    if ((await api(me, "GET", "/songbooks")).find((b) => b.id === book.id)?.color !== "amber") throw new Error("not saved");
  });
} finally {
  await call(me, "DELETE", `/songbooks/${book.id}`);
  await call(me, "DELETE", `/teams/${team.id}`);
  await browser.close();
}
finish();
