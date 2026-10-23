// Cue (issue #322): a singer whose role moves the screens on finds the cues in
// Live's Sync menu, not presenting, and pressing one moves the set's screens
// to the next section.
import { chromium } from "playwright";
import { WEB, api, call, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Cue web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const leader = await user("Cue web leader");
const singer = await user("Cue web singer");
const role = await api(admin, "POST", "/admin/roles", { name: `Cue web ${stamp}`, canCue: true });
await api(admin, "PUT", `/admin/users/${singer.id}/roles`, { roleIds: [role.id, "role_audio_uploads"] });
const set = await api(leader, "POST", "/setlists", { name: `Cue web ${stamp}` });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo\n\nThree" } });
const itemId = items[0].id;
const token = (await api(leader, "POST", `/setlists/${set.id}/share-link`)).link.token;
await call(singer, "POST", `/set-invites/${token}/join`);

const browser = await chromium.launch();
let desk;
try {
  desk = await syncDevice(leader);
  desk.send({ type: "join", setId: set.id, deviceId: `cue-desk-${stamp}` });
  await desk.next((m) => m.type === "session");
  desk.send({ type: "command", id: `lead-${stamp}`, op: { kind: "lead" } });
  desk.send({ type: "command", id: `show-${stamp}`, op: { kind: "present", presenting: { itemId, slide: 0, black: false } } });
  await desk.next((m) => m.type === "ack" && m.id === `show-${stamp}`);

  const phone = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
  await step("the singer's Sync menu has the cues, not Present", async () => {
    page = phone;
    await signIn(phone, singer);
    await phone.evaluate(() => localStorage.setItem("songverse.mode", "live"));
    await phone.goto(`${WEB}/sets/${set.id}/live/${itemId}`);
    const control = phone.getByTestId("sync-control").first();
    await control.click();
    await phone.getByTestId("sync-menu").getByRole("menuitem", { name: "Turn sync on" }).click();
    await phone.locator('[data-testid="sync-control"][data-state-sync="on"]').first().waitFor();
    await control.click();
    await phone.getByTestId("sync-cue-next-section").waitFor();
    if (await phone.getByTestId("sync-present").count()) throw new Error("Present is offered to someone who only cues");
  });

  await step("Next section moves the screens to the next paragraph", async () => {
    desk.drain();
    await phone.getByTestId("sync-cue-next-section").click();
    const moved = await desk.next((m) => m.type === "session" && m.session?.presenting?.slide === 1, 5000);
    if (!moved) throw new Error("the screens didn't move");
  });
} finally {
  desk?.close();
  await browser.close();
}

finish();
