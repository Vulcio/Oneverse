// One set per event date, edited by the teams chosen (issue #578), in the
// browser: the organisation's event (the same page in Plan and Songverse) says whether its dates have a
// set and which teams edit it, and one date gives editing to a team that
// usually views it; in Songverse, someone who only views the date's set asks
// to edit it, and someone on the line-up of a team that edits it grants it.
import { chromium } from "playwright";
import { PLANIVERSE, WEB, api, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Set editing web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const planner = await user("Set editing web planner");
const drummer = await user("Set editing web drummer");
const techie = await user("Set editing web techie");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const org = await api(planner, "POST", "/organizations", { name: `Set editing web ${stamp}` });
const music = await api(planner, "POST", `/organizations/${org.id}/groups`, { name: `Music ${stamp}`, usesSongverse: true });
const media = await api(planner, "POST", `/organizations/${org.id}/groups`, { name: `Media ${stamp}`, usesSongverse: true });
[
  [drummer, music],
  [techie, media],
].forEach(([who, team], n) => {
  sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('omsew${n}${stamp}', '${org.id}', '${who.id}', 'MEMBER', now(), now()) on conflict do nothing`);
  sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmsew${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`);
});

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" });
  let event;

  await step("an organisation's event, one set per date, the media team only viewing it", async () => {
    await signIn(page, planner);
    await page.goto(`${PLANIVERSE}/organizations/${org.id}/events`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("org-new-event").click();
    const dialog = page.getByTestId("org-event-dialog");
    await dialog.locator("#org-event-title").fill(`Sunday ${stamp}`);
    await dialog.getByTestId("org-event-host").selectOption({ label: "Set editing web planner" });
    for (const team of [music, media]) await dialog.getByTestId("org-event-add-group").selectOption(team.id);
    check("one set for each date, on by default", await dialog.getByTestId("org-event-with-set").isChecked());
    const mediaNeed = dialog.locator(`[data-need="${media.name}"]`);
    check("each team edits it by default", await mediaNeed.getByTestId("need-edits-set").isChecked());
    await mediaNeed.getByTestId("need-edits-set").uncheck();
    await dialog.getByTestId("org-event-save").click();
    await dialog.waitFor({ state: "hidden" });
    event = (await api(planner, "GET", `/organizations/${org.id}/events`)).find((one) => one.title === `Sunday ${stamp}`);
    check("saved: the media team views the set", event?.withSet === true && event.needs.find((need) => need.teamId === media.id)?.editsSet === false && event.needs.find((need) => need.teamId === music.id)?.editsSet === true, JSON.stringify(event?.needs));
  });

  const first = () => event.date;
  await step("one date gives the media team editing", async () => {
    const row = page.locator(`[data-org-event="${event.id}"][data-org-event-date="${first()}"]`);
    await row.locator(`[data-org-group="${music.id}"]`).getByTestId("org-group-edits-set").waitFor();
    check("only the music team is marked as editing it", (await row.locator(`[data-org-group="${media.id}"]`).getByTestId("org-group-edits-set").count()) === 0);
    await row.getByRole("button", { name: /actions/i }).click();
    await page.getByTestId("org-date-editors").click();
    const dialog = page.getByTestId("org-date-editors-dialog");
    await dialog.locator(`[data-editors-group="${media.name}"]`).getByTestId("org-date-editors-choice").selectOption("edit");
    await row.locator(`[data-org-group="${media.id}"]`).getByTestId("org-group-edits-set").waitFor();
    // Back to usual.
    await dialog.locator(`[data-editors-group="${media.name}"]`).getByTestId("org-date-editors-choice").selectOption("");
    await row.locator(`[data-org-group="${media.id}"]`).getByTestId("org-group-edits-set").waitFor({ state: "detached" });
    await dialog.getByTestId("org-date-editors-done").click();
  });

  // The music team needs a drummer, who's on the date's line-up.
  await api(planner, "PATCH", `/organizations/${org.id}/events/${event.id}`, { needs: [{ teamId: music.id, parts: [{ part: "DRUMS", count: 1 }] }, { teamId: media.id, editsSet: false }] });
  const music_ = (await api(planner, "GET", `/teams/${music.id}/events`)).find((one) => one.organizationEventId === event.id);
  await api(planner, "POST", `/teams/${music.id}/events/${music_.id}/dates/${first()}/lineup`, { userId: drummer.id, part: "DRUMS" });
  const { setlistId } = (await api(planner, "GET", `/teams/${music.id}/event-dates?from=${first()}&to=${first()}`)).find((one) => one.eventId === music_.id);

  await step("Songverse: the techie, who views the set, asks to edit it", async () => {
    await page.context().clearCookies();
    await signIn(page, techie);
    await page.goto(`${WEB}/sets/${setlistId}`);
    await page.getByTestId("set-ask-to-edit-button").click();
    await page.locator('[data-testid="set-ask-to-edit"][data-status="PENDING"]').waitFor();
  });

  await step("the drummer on the line-up grants it from the set's page", async () => {
    await page.context().clearCookies();
    await signIn(page, drummer);
    await page.goto(`${WEB}/sets/${setlistId}`);
    const asked = page.getByTestId("set-edit-requests").locator(`[data-edit-request="Set editing web techie"]`);
    await asked.getByTestId("set-edit-request-grant").click();
    await page.getByTestId("set-edit-requests").locator('[data-status="GRANTED"]').waitFor();
  });

  await step("the techie edits it now", async () => {
    await page.context().clearCookies();
    await signIn(page, techie);
    await page.goto(`${WEB}/sets/${setlistId}`);
    await page.getByTestId("set-operate").waitFor();
    check("no more asking", (await page.getByTestId("set-ask-to-edit").count()) === 0);
  });
} finally {
  await browser.close();
  await api(admin, "DELETE", "/admin/organizations/settings").catch(() => {});
}
finish();
