// Dark mode's drop-down lists (issue #167): a native select's open list is
// drawn by the browser, light on Windows whatever the page - its options
// take the theme's colours, so they read on the dark theme.
import { chromium } from "playwright";
import { WEB, finish, signIn, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Dark");
const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.theme", "dark"));

  await step("on the dark theme, a drop-down's options are dark with light text", async () => {
    await page.goto(`${WEB}/settings/account`);
    await page.locator("html.dark").waitFor({ state: "attached" });
    const select = page.getByTestId("language-card").locator("select").first();
    await select.waitFor();
    const colours = await select.evaluate((element) => {
      const option = element.querySelector("option");
      const style = getComputedStyle(option);
      // How light a colour is, 0 to 1: oklch's own L, or an rgb's luminance.
      const light = (colour) => {
        const [a, b, c] = colour.match(/[\d.]+/g).map(Number);
        return colour.startsWith("oklch") ? a : (0.2126 * a + 0.7152 * b + 0.0722 * c) / 255;
      };
      return { transparent: style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent", scheme: getComputedStyle(document.documentElement).colorScheme, background: light(style.backgroundColor), text: light(style.color) };
    });
    if (colours.scheme !== "dark") throw new Error(`color-scheme ${colours.scheme}`);
    // Left transparent, the browser's own (light) list shows through.
    if (colours.transparent || !(colours.background < 0.3 && colours.text > 0.7)) throw new Error(JSON.stringify(colours));
  });
} finally {
  await browser.close();
}
finish();
