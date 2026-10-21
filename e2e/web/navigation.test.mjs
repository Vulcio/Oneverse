// Page changes reuse the signed-in session and sidebar lists instead of
// refetching them every time, and still pick up changes made in the app.
import { chromium } from "playwright";
import { API, WEB, api, finish, railLink, sidebarEntry, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Navigator");
const navSet = await api(me, "POST", "/setlists", { name: `Nav set ${stamp}` });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);
await page.goto(`${WEB}/library`);
await page.waitForLoadState("networkidle");

const requests = [];
page.on("request", (r) => requests.push(r.url()));
const go = async (href) => {
  await page.locator(`a[href="${href}"]`).first().click();
  await page.waitForURL(`${WEB}${href}`);
  await page.waitForLoadState("networkidle");
};

await step("changing pages doesn't refetch the session and sidebar every time", async () => {
  for (const href of ["/sets", "/library", "/songbooks", "/library", "/sets"]) await go(href);
  const sidebarLists = requests.filter((u) => /^\S+\/(teams|songbooks|setlists)$/.test(u.replace(API, "API"))).length;
  const pageLists = 3; // /sets twice and /songbooks once load their own list
  // At most one reload of the three sidebar lists, on top of the pages' own.
  if (sidebarLists > pageLists + 3) throw new Error(`${sidebarLists} list requests: ${requests.filter((u) => u.startsWith(API)).join(" ")}`);
});

await step("a set created in the app shows in the sidebar straight away", async () => {
  await go("/sets/new");
  await page.fill("#set-name", `Fresh set ${stamp}`);
  await page.getByRole("button", { name: /Create/ }).click();
  await page.waitForURL(/\/sets\/(?!new)[a-z0-9]+/);
  // The page's own heading has the name too; the sidebar's panel lists the sets, this one among them.
  await (await sidebarEntry(page, "Sets", `Fresh set ${stamp}`)).waitFor({ timeout: 10000 });
});

await step("no breadcrumb: the sidebar marks where you are", async () => {
  await page.goto(`${WEB}/sets/${navSet.id}`);
  await page.waitForLoadState("networkidle");
  if (await page.getByRole("navigation", { name: "breadcrumb" }).count()) throw new Error("a breadcrumb");
  // The rail marks Sets, and the panel the set (issue #80).
  if ((await railLink(page, "Sets").getAttribute("data-active")) !== "true") throw new Error("Sets isn't marked");
  const entry = await sidebarEntry(page, "Sets", `Nav set ${stamp}`);
  if ((await entry.getAttribute("aria-current")) !== "page") throw new Error("the set isn't marked");
});

await step("Help opens the docs page about where you are, in your language, showing what you can use (issue #160)", async () => {
  const help = async () => {
    await page.getByRole("button", { name: "Navigator" }).click();
    const href = await page.getByRole("menuitem", { name: /Help|Aide/ }).getAttribute("href");
    await page.keyboard.press("Escape");
    return href;
  };
  await page.goto(`${WEB}/sets`);
  await page.waitForLoadState("networkidle");
  if ((await help()) !== "https://docs.oneverse.top/sets/?view=member") throw new Error(`on /sets: ${await help()}`);
  sql(`update "User" set locale='fr' where id='${me.id}'`);
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  if ((await help()) !== "https://docs.oneverse.top/fr/library/?view=member") throw new Error(`in French, on /library: ${await help()}`);
});

await browser.close();
finish();
