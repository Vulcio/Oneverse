// Registration for event dates (issue #593) in the browser: a team's admin
// makes a weekend (one date over three days), turns registration on from the
// date's page - place kinds with prices, a question - and someone without an
// account registers on the public page in Oneverse, then changes their
// places from their registration's page. The admin sees them on the date's
// list, marks them paid and exports the list.
import { chromium } from "playwright";
import { ONEVERSE, WEB, api, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Regweb admin");
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const team = await api(admin, "POST", "/teams", { name: `Regweb church ${stamp}` });
const friday = plus(12);
// Its last day, as the pages write it ("Sun, December 13…"): the day of the month.
const lastDay = String(new Date(`${plus(14)}T12:00:00Z`).getUTCDate());
const endsOn = (text) => new RegExp(`– \\w+, \\w+ ${lastDay} at`).test(text);

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" });
  await signIn(page, admin);
  let eventId;

  await step("a weekend is one event date over several days", async () => {
    const weekend = await api(admin, "POST", `/teams/${team.id}/events`, { title: `Weekend ${stamp}`, date: friday, startTime: "19:00", timeZone: "UTC", durationMinutes: 90 });
    eventId = weekend.id;
    await page.goto(`${WEB}/events/${eventId}/${friday}`);
    await page.getByTestId("event-date-page").waitFor();
    // Made longer through the API (the dialog's "Several days" sets the same minutes).
    await api(admin, "PATCH", `/teams/${team.id}/events/${eventId}`, { durationMinutes: 2 * 24 * 60 - 3 * 60 });
    await page.reload();
    const when = await page.getByTestId("event-date-page").innerText();
    check("the date's page says the day it ends on", new RegExp(`– \\w+, \\w+ ${lastDay},`).test(when), when.slice(0, 300));
  });

  await step("its admin turns registration on from the date's page", async () => {
    const card = page.getByTestId("registration-card");
    await card.waitFor();
    await card.getByTestId("registration-settings").click();
    const dialog = page.getByTestId("registration-dialog");
    await dialog.getByTestId("registration-limit").fill("30");
    await dialog.getByTestId("registration-kind-name").first().fill("Adult");
    await dialog.getByTestId("registration-kind-price").first().fill("40");
    await dialog.getByTestId("registration-add-kind").click();
    await dialog.getByTestId("registration-kind-name").nth(1).fill("Child");
    await dialog.getByTestId("registration-kind-limit").nth(1).fill("10");
    await dialog.getByTestId("registration-kind-price").nth(1).fill("15,50");
    await dialog.getByTestId("registration-add-question").click();
    await dialog.getByTestId("registration-question-label").fill("Diet");
    await dialog.getByTestId("registration-question-type").selectOption("choice");
    await dialog.getByTestId("registration-question-options").fill("None, Vegetarian");
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/registration-settings.png` });
    await dialog.getByTestId("registration-save").click();
    await dialog.waitFor({ state: "detached" });
    await card.getByTestId("registration-link").waitFor();
    check("the card shows the public link, in Oneverse", (await card.getByTestId("registration-link").innerText()).startsWith(`${ONEVERSE}/register/`));
    await card.getByText("Nobody has registered").waitFor();
    check("nobody yet", true);
  });

  const link = await page.getByTestId("registration-link").innerText();
  const visitor = await browser.newPage({ viewport: { width: 400, height: 900 }, timezoneId: "UTC" });

  await step("someone without an account registers on the public page", async () => {
    await visitor.goto(link, { waitUntil: "networkidle" });
    await visitor.getByTestId("registration-page").waitFor();
    check("the page shows the weekend, to its last day", endsOn(await visitor.getByTestId("registration-date").first().innerText()), await visitor.getByTestId("registration-date").first().innerText());
    await visitor.locator("[data-testid=registration-kind][data-kind=Adult]").getByTestId("registration-more").click();
    await visitor.locator("[data-testid=registration-kind][data-kind=Adult]").getByTestId("registration-more").click();
    await visitor.locator("[data-testid=registration-kind][data-kind=Child]").getByTestId("registration-more").click();
    await visitor.getByTestId("registration-questions").locator("select").selectOption("Vegetarian");
    await visitor.getByTestId("registration-name").fill("The Durands");
    await visitor.getByTestId("registration-email").fill(`durands-${stamp}@example.com`);
    check("the total adds up the prices", (await visitor.getByTestId("registration-total").innerText()).includes("95.50"));
    if (process.env.E2E_SHOTS) await visitor.screenshot({ path: `${process.env.E2E_SHOTS}/registration-public-page.png`, fullPage: true });
    await visitor.getByTestId("registration-submit").click();
    await visitor.waitForURL(`${ONEVERSE}/registration/**`);
    await visitor.locator("[data-testid=my-registration][data-status=CONFIRMED]").waitFor();
    if (process.env.E2E_SHOTS) await visitor.screenshot({ path: `${process.env.E2E_SHOTS}/registration-registered.png`, fullPage: true });
    check("their registration's page says they're registered", (await visitor.getByTestId("my-registration-status").innerText()).includes("You're registered"));
  });

  await step("they change their places from their registration's page", async () => {
    await visitor.getByTestId("my-registration-change").click();
    await visitor.locator("[data-testid=registration-kind][data-kind=Child]").getByTestId("registration-more").click();
    await visitor.getByTestId("my-registration-save").click();
    await visitor.getByTestId("my-registration-places").filter({ hasText: "2 × Child" }).waitFor();
    check("two children now", true);
  });

  await step("the admin sees them on the date's list, marks them paid and exports it", async () => {
    await page.reload();
    const row = page.getByTestId("registration-row").filter({ hasText: "The Durands" });
    await row.waitFor();
    check("with their places and answer", (await row.innerText()).includes("2 × Child") && (await row.innerText()).includes("Vegetarian"), await row.innerText());
    check("the summary counts 4 places taken", (await page.getByTestId("registration-summary").innerText()).includes("4 places taken"));
    // Checked once the API says so (the box follows the list).
    await row.getByTestId("registration-paid").click();
    await page.locator("[data-testid=registration-row]:has-text('The Durands') [data-testid=registration-paid]:checked").waitFor();
    if (process.env.E2E_SHOTS) await page.getByTestId("registration-card").screenshot({ path: `${process.env.E2E_SHOTS}/registration-list.png` });
    const download = page.waitForEvent("download");
    await page.getByTestId("registration-export").click();
    check("the CSV downloads", (await (await download).suggestedFilename()).endsWith(".csv"));
    await visitor.reload({ waitUntil: "networkidle" });
    check("the paid mark shows on their page", (await visitor.getByTestId("my-registration-status").innerText()).includes("Paid"));
  });
} finally {
  await browser.close();
}
finish();
