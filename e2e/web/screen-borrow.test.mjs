// A screen borrowed for a set (issue #480): the operator puts their set on one of their team's screens that shows
// another set now - the lobby TV - for a few hours; it shows that set at once, and goes back to what it showed when
// given back, or by itself when the time is up. Only someone who can edit the set borrows for it.
import { chromium } from "playwright";
import { SCREEN, WEB, api, call, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const leader = await user("Borrow leader");
const outsider = await user("Borrow outsider");
const team = await api(leader, "POST", "/teams", { name: `Borrow team ${stamp}` });
const sunday = await api(leader, "POST", "/setlists", { name: `Sunday ${stamp}`, teamId: team.id });
const concert = await api(leader, "POST", "/setlists", { name: `Concert ${stamp}`, teamId: team.id });
const song = await api(leader, "POST", "/song-versions", { title: `Borrowed song ${stamp}`, language: "en", artists: ["Someone"], teamId: team.id, content: "{start_of_verse}\nA line here\n{end_of_verse}\n", contentFormat: "CHORDPRO" });
await api(leader, "POST", `/setlists/${concert.id}/items`, { songVersionId: song.id });

const browser = await chromium.launch();
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const desk = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  let lobby;

  await step("the team's lobby TV, showing Sunday's set", async () => {
    page = tv;
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    lobby = await api(leader, "POST", `/screens/pairings/${code}/confirm`, { owner: { kind: "team", id: team.id }, name: `Lobby ${stamp}`, mode: "LYRICS", setlistId: sunday.id });
    await tv.getByTestId("screen-idle").getByText(`Sunday ${stamp}`).waitFor({ timeout: 15000 });
  });

  await step("the API: who may borrow, for how long", async () => {
    const borrowable = await api(leader, "GET", `/screens/borrowable?setlistId=${concert.id}`);
    check("…the lobby TV can be borrowed for the concert", borrowable.some((screen) => screen.id === lobby.id), JSON.stringify(borrowable));
    const already = await api(leader, "GET", `/screens/borrowable?setlistId=${sunday.id}`);
    check("…not for the set it shows already", !already.some((screen) => screen.id === lobby.id));
    let r = await call(outsider, "GET", `/screens/borrowable?setlistId=${concert.id}`);
    check("…someone who can't edit the set can't", r.status === 403 || r.status === 404, String(r.status));
    r = await call(outsider, "POST", `/screens/${lobby.id}/borrow`, { setlistId: concert.id });
    check("…nor borrow it", r.status === 403 || r.status === 404, String(r.status));
    r = await call(leader, "POST", `/screens/${lobby.id}/borrow`, { setlistId: concert.id, hours: 5 });
    check("…5 hours isn't one of the lengths", r.status === 400, JSON.stringify(r.body));
  });

  await step("borrowed from the operator's console: the TV shows the concert, marked borrowed", async () => {
    page = desk;
    await signIn(desk, leader);
    await desk.goto(`${WEB}/sets/${concert.id}/operate`);
    await desk.getByTestId("operator-control").waitFor({ timeout: 15000 });
    await desk.getByTestId("operator-drawer-open").click();
    const drawer = desk.getByTestId("operator-drawer");
    await drawer.getByTestId("operator-borrow").click();
    const list = desk.getByTestId("operator-borrow-list");
    await list.getByTestId("operator-borrow-hours").selectOption("1");
    await list.locator(`[data-testid="operator-borrow-screen"][data-screen="${lobby.id}"]`).getByTestId("operator-borrow-go").click();
    await list.waitFor({ state: "detached" });
    page = tv;
    await tv.getByTestId("screen-idle").getByText(`Concert ${stamp}`).waitFor({ timeout: 15000 });
    page = desk;
    const tile = drawer.locator(`[data-testid="operator-screen-tile"][data-screen="${lobby.id}"][data-borrowed]`);
    await tile.getByTestId("operator-screen-borrowed").waitFor({ timeout: 15000 });
    const shown = (await api(leader, "GET", "/screens")).find((screen) => screen.id === lobby.id);
    const left = new Date(shown.borrowed?.until ?? 0).getTime() - Date.now();
    check("…borrowed for an hour", shown.setlistId === concert.id && left > 55 * 60_000 && left <= 60 * 60_000, JSON.stringify(shown.borrowed));
  });

  await step("borrowed again meanwhile, then given back: Sunday's set, not the concert's", async () => {
    await api(leader, "POST", `/screens/${lobby.id}/borrow`, { setlistId: concert.id, hours: 3 });
    page = desk;
    const tile = desk.locator(`[data-testid="operator-screen-tile"][data-screen="${lobby.id}"]`);
    await tile.getByTestId("operator-screen-give-back").click();
    page = tv;
    await tv.getByTestId("screen-idle").getByText(`Sunday ${stamp}`).waitFor({ timeout: 15000 });
    page = desk;
    await tile.waitFor({ state: "detached", timeout: 15000 });
    const back = (await api(leader, "GET", "/screens")).find((screen) => screen.id === lobby.id);
    check("…its own set again, not borrowed", back.setlistId === sunday.id && back.setMode === "FIXED" && !back.borrowed, JSON.stringify(back));
  });

  await step("the time up: back by itself", async () => {
    await api(leader, "POST", `/screens/${lobby.id}/borrow`, { setlistId: concert.id, hours: 1 });
    page = tv;
    await tv.getByTestId("screen-idle").getByText(`Concert ${stamp}`).waitFor({ timeout: 15000 });
    sql(`UPDATE "Screen" SET "borrowedUntil" = now() - interval '1 minute' WHERE id = '${lobby.id}'`);
    // Whichever comes first: the Worker's minute, or the screen loading again.
    await tv.reload();
    await tv.getByTestId("screen-idle").getByText(`Sunday ${stamp}`).waitFor({ timeout: 15000 });
    const back = (await api(leader, "GET", "/screens")).find((screen) => screen.id === lobby.id);
    check("…its own set again", back.setlistId === sunday.id && !back.borrowed, JSON.stringify(back));
  });

  await step("its set changed in its settings while borrowed: that's what it shows, nothing given back later", async () => {
    await api(leader, "POST", `/screens/${lobby.id}/borrow`, { setlistId: concert.id, hours: 1 });
    const changed = await api(leader, "PATCH", `/screens/${lobby.id}`, { setlistId: concert.id });
    check("…not borrowed any more", !changed.borrowed && changed.setlistId === concert.id, JSON.stringify(changed));
    await api(leader, "PATCH", `/screens/${lobby.id}`, { setlistId: sunday.id });
  });
} finally {
  await browser.close();
}

finish();
