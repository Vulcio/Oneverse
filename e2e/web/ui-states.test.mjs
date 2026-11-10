// One way to show each state (issue #425): "nothing yet" is an Empty, a notice is an Alert,
// "it worked" is a toast with what to do next, and the status colours follow light and dark.
import { chromium } from "playwright";
import { api, finish, signIn, stepper, tag, user, WEB } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

const me = await user("States");

const browser = await chromium.launch();
page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

await step("with nothing yet, the sets and the notifications say so the same way", async () => {
  await signIn(page, me);
  await page.goto(`${WEB}/sets`);
  await page.locator('[data-slot="empty"]').getByText("No sets yet").waitFor();
  // The bell too.
  await page.getByTestId("notification-bell").click();
  await page.locator('[data-slot="empty"]').filter({ hasText: "Nothing new." }).waitFor();
  await page.keyboard.press("Escape");
});

await step("the colours for fine and mind this are lighter on a dark page", async () => {
  const lightness = () =>
    page.evaluate(() => {
      const read = (name) => {
        const probe = document.createElement("span");
        probe.style.color = `var(--${name})`;
        document.body.append(probe);
        const [l] = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(Number);
        probe.remove();
        return l;
      };
      return { success: read("success"), warning: read("warning") };
    });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const light = await lightness();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const dark = await lightness();
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  if (!(light.success > 0 && light.warning > 0)) throw new Error(`no colours: ${JSON.stringify(light)}`);
  if (!(dark.success > light.success && dark.warning > light.warning)) throw new Error(JSON.stringify({ light, dark }));
});

await step("a song dropped on a set: a toast says so, and opens the set", async () => {
  const song = await api(me, "POST", "/song-versions", { artists: ["Test Artist"], title: `Stated ${tag}`, language: "en" });
  const set = await api(me, "POST", "/setlists", { name: `States set ${tag}` });
  await page.goto(`${WEB}/library/songs?q=${encodeURIComponent(`Stated ${tag}`)}`);
  const row = page.getByTestId("library-song-row").filter({ hasText: `Stated ${tag}` });
  await row.waitFor();
  await row.hover();
  await page.mouse.down();
  await page.mouse.move(400, 300, { steps: 4 });
  const entry = page.locator('[data-slot="sidebar"] [data-drop-state="addable"]').filter({ hasText: `States set ${tag}` });
  await entry.waitFor();
  const to = await entry.boundingBox();
  await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  const toast = page.locator('[data-slot="toast"]').filter({ hasText: `Stated ${tag} added to States set ${tag}` });
  await toast.waitFor();
  if ((await toast.getAttribute("data-kind")) !== "success") throw new Error("not a success toast");
  // Its close button has a name (kept from screen readers until the toasts are focused, as Base UI does).
  if ((await toast.locator('[data-slot="toast-close"]').getAttribute("aria-label")) !== "Close") throw new Error("the close button has no name");
  await toast.getByRole("button", { name: "Open set" }).click();
  await page.waitForURL(new RegExp(`/sets/${set.id}`));
  if (!(await api(me, "GET", `/setlists/${set.id}`)).items?.some((item) => item.song?.id === song.id)) throw new Error("not in the set");
});

await browser.close();
finish();
