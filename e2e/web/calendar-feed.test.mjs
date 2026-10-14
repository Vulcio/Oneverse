// The calendar link on My calendar (issue #235): made on demand; copied,
// or added to Google, Apple (webcal:) or Outlook; the feed it opens lists
// the dates signed up for; reset (the old link stops) and turned off.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Feed web");
const team = await api(me, "POST", "/teams", { name: `Feed web ${stamp}` });
const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const event = await api(me, "POST", `/teams/${team.id}/events`, { title: "Rehearsal", date: plus(2), startTime: "19:30", timeZone: "UTC" });
await api(me, "PUT", `/teams/${team.id}/events/${event.id}/dates/${plus(2)}/answer`, { answer: "AVAILABLE" });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  page = await context.newPage();
  await signIn(page, me);
  const card = () => page.getByTestId("calendar-feed");
  let url;

  await step("Get my calendar link: the link, copied; the feed lists the date signed up for", async () => {
    await page.goto(`${WEB}/calendar`);
    await card().getByTestId("calendar-feed-make").click();
    url = await card().getByTestId("calendar-feed-url").inputValue();
    if (!/\/calendar\/[A-Za-z0-9_-]+\.ics$/.test(url)) throw new Error(url);
    await card().getByTestId("calendar-feed-copy").click();
    await card().getByText("Copied").waitFor();
    if ((await page.evaluate(() => navigator.clipboard.readText())) !== url) throw new Error("not copied");
    const feed = await (await fetch(url)).text();
    if (!feed.includes(`SUMMARY:Rehearsal (Feed web ${stamp})`)) throw new Error(feed);
  });

  await step("added to Google, Apple and Outlook with the link", async () => {
    const webcal = url.replace(/^https?:/, "webcal:");
    const href = (id) => card().getByTestId(id).getAttribute("href");
    if ((await href("calendar-feed-apple")) !== webcal) throw new Error("Apple");
    if (!(await href("calendar-feed-google")).endsWith(`cid=${encodeURIComponent(webcal)}`)) throw new Error("Google");
    if (!(await href("calendar-feed-outlook")).includes(`url=${encodeURIComponent(url)}`)) throw new Error("Outlook");
  });

  await step("Reset link: a new one, the old one stops; kept when the page is opened again", async () => {
    await card().getByRole("button", { name: "Reset link" }).click();
    await card().getByRole("button", { name: "Reset: the old link stops working" }).click();
    await page.waitForFunction((old) => document.querySelector('[data-testid="calendar-feed-url"]')?.value !== old, url);
    const fresh = await card().getByTestId("calendar-feed-url").inputValue();
    if ((await fetch(url)).status !== 404 || (await fetch(fresh)).status !== 200) throw new Error("not reset");
    await page.reload();
    if ((await card().getByTestId("calendar-feed-url").inputValue()) !== fresh) throw new Error("not kept");
    url = fresh;
  });

  await step("Turn off: no link", async () => {
    await card().getByTestId("calendar-feed-off").click();
    await card().getByTestId("calendar-feed-make").waitFor();
    if ((await fetch(url)).status !== 404) throw new Error("still on");
  });

  await step("a team's admins get the team's link on its page (issue #240)", async () => {
    await page.goto(`${WEB}/teams/${team.id}`);
    const teamCard = page.getByTestId("team-calendar-feed");
    await teamCard.getByRole("button", { name: "Get the team's calendar link" }).click();
    const teamUrl = await teamCard.getByTestId("calendar-feed-url").inputValue();
    if (!(await (await fetch(teamUrl)).text()).includes("SUMMARY:Rehearsal\r\n")) throw new Error("not the team's dates");
    await teamCard.getByTestId("calendar-feed-off").click();
    await teamCard.getByTestId("calendar-feed-make").waitFor();
  });
} finally {
  await browser.close();
}
finish();
