// Who can play, on the set's page (issue #520): a member answering
// Available picks the parts they'd like to play; the admin opening the
// date's set sees the answers grouped (Available, If needed, Not
// available, No reply) with each person's wishes, and who hosts and leads
// the music. The music leader on the line-up edits the set there too.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const shots = process.env.E2E_SHOTS;
const admin = await user("Sam Admin");
const member = await user("Lou Drums");
const leader = await user("Ana Leader");
const away = await user("Max Bass");
const quiet = await user("Zoe Keys");
sql(`update "User" set instruments='{DRUMS}' where id='${member.id}'`);
sql(`update "User" set instruments='{LEAD_VOCALS}', "techRoles"='{MUSIC_LEADER}' where id='${leader.id}'`);
const team = await api(admin, "POST", "/teams", { name: `Who plays ${stamp}` });
[member, leader, away, quiet].forEach((who, n) =>
  sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmwp${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`),
);
const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const event = await api(admin, "POST", `/teams/${team.id}/events`, {
  title: "Sunday service",
  date,
  startTime: "10:00",
  timeZone: "UTC",
  parts: [{ part: "HOST", count: 1 }, { part: "MUSIC_LEADER", count: 1 }, { part: "LEAD_VOCALS", count: 1 }, { part: "DRUMS", count: 1 }],
});
const base = `/teams/${team.id}/events/${event.id}/dates/${date}`;
await api(leader, "PUT", `${base}/answer`, { answer: "AVAILABLE", wishes: ["MUSIC_LEADER", "LEAD_VOCALS"] });
await api(away, "PUT", `${base}/answer`, { answer: "UNAVAILABLE", note: "Away that weekend" });
await api(admin, "PUT", `${base}/answer`, { answer: "IF_NEEDED", wishes: ["HOST"] });
const { setlistId } = await api(admin, "POST", `${base}/set`);

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "UTC", deviceScaleFactor: shots ? 2 : 1 });
  const row = page.locator(`[data-event-date="${date}"]`).first();

  await step("a member answers Available and picks what they'd like to play", async () => {
    await signIn(page, member);
    await page.goto(`${WEB}/teams/${team.id}`);
    await row.getByTestId("answer-AVAILABLE").click();
    await row.locator('[data-answer="AVAILABLE"]').waitFor();
    await row.getByTestId("answer-wishes").click();
    await page.locator('[data-wish="DRUMS"]').click();
    await page.locator('[data-wish="DRUMS"][aria-pressed="true"]').waitFor();
    if (shots) await page.screenshot({ path: `${shots}/answer-roles.png` });
    await page.keyboard.press("Escape");
    await row.getByTestId("answer-wishes").getByText("Drums").waitFor();
  });

  await step("the admin opens the date's set: who can play, grouped, with what each would like", async () => {
    await page.context().clearCookies();
    await signIn(page, admin);
    await page.goto(`${WEB}/sets/${setlistId}`);
    const card = page.getByTestId("set-availability");
    await card.waitFor();
    await card.locator(`[data-group="AVAILABLE"] [data-member="${member.id}"] [data-wish="DRUMS"]`).waitFor();
    await card.locator(`[data-group="AVAILABLE"] [data-member="${leader.id}"] [data-wish="MUSIC_LEADER"]`).waitFor();
    await card.locator(`[data-group="IF_NEEDED"] [data-member="${admin.id}"]`).waitFor();
    await card.locator(`[data-group="UNAVAILABLE"] [data-member="${away.id}"]`).getByText("Away that weekend").waitFor();
    await card.locator('[data-group="NONE"]').getByText("Zoe Keys").waitFor();
    await card.locator('[data-leading="MUSIC_LEADER"]').getByText("Would like to: Ana Leader").waitFor();
    if (shots) await card.screenshot({ path: `${shots}/set-who-can-play.png` });
  });

  await step("the music leader on the line-up edits the set, without deleting it", async () => {
    const place = await api(admin, "POST", `${base}/lineup`, { userId: leader.id, part: "MUSIC_LEADER" });
    await api(leader, "PUT", `${base}/lineup/${place.id}/response`, { status: "ACCEPTED" });
    await page.context().clearCookies();
    await signIn(page, leader);
    await page.goto(`${WEB}/sets/${setlistId}`);
    const card = page.getByTestId("set-availability");
    await card.locator('[data-leading="MUSIC_LEADER"]').getByText("Music leader: Ana Leader").waitFor();
    await page.getByText("Add songs").first().waitFor();
    if (await page.getByRole("button", { name: "Delete set" }).count()) throw new Error("the music leader can delete the set");
    if (shots) await page.screenshot({ path: `${shots}/leader-set-page.png` });
  });
} finally {
  await browser.close();
}
await finish();
