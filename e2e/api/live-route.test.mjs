// Route (issue #322): someone whose role routes the screens changes what they
// draw - layers hidden or cleared, the title card - for all of them or one,
// without presenting, nor the timer or the message. While someone runs the
// screens alone, only they route them (#275: the exclusive operator holds
// Present and Route) - the leader included.
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

const admin = await user("Route admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const leader = await user("Route leader");
const router = await user("Route tech");
const operator = await user("Route operator");
const guest = await user("Route guest");

const role = await api(admin, "POST", "/admin/roles", { name: `Route ${stamp}`, canRoute: true });
check("Admin > Roles: a role that routes the screens", (await api(admin, "GET", "/admin/roles")).find((one) => one.id === role.id)?.canRoute === true);
await api(admin, "PUT", `/admin/users/${router.id}/roles`, { roleIds: [role.id, "role_audio_uploads"] });
const runs = await api(admin, "POST", "/admin/roles", { name: `Route runs ${stamp}`, canOperateScreens: true });
await api(admin, "PUT", `/admin/users/${operator.id}/roles`, { roleIds: [runs.id, "role_audio_uploads"] });

const set = await api(leader, "POST", "/setlists", { name: `Route ${stamp}` });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo" } });
const token = (await api(leader, "POST", `/setlists/${set.id}/share-link`)).link.token;
for (const who of [router, operator, guest]) await call(who, "POST", `/set-invites/${token}/join`);

const devices = [];
async function joined(who, name) {
  const device = await syncDevice(who);
  devices.push(device);
  device.send({ type: "join", setId: set.id, deviceId: `${name}-${stamp}` });
  return { device, session: await device.next((m) => m.type === "session") };
}
const stageWhere = (device, test) => device.next((m) => m.type === "session" && !!m.stage && test(m.stage), 3000);
const refusal = (device) => device.next((m) => m.type === "error", 1500);

try {
  const { device: desk } = await joined(leader, "desk");
  desk.send({ type: "command", id: `lead-${stamp}`, op: { kind: "lead" } });
  desk.send({ type: "command", id: `show-${stamp}`, op: { kind: "present", presenting: { itemId: items[0].id, slide: 0, black: false } } });
  await desk.next((m) => m.type === "ack" && m.id === `show-${stamp}`);

  const { device: tech, session: first } = await joined(router, "tech");
  check("the tech may route, not present nor run the screens", first?.canRoute === true && first.canPresent === false && first.canOperate === false, JSON.stringify({ canRoute: first?.canRoute, canPresent: first?.canPresent, canOperate: first?.canOperate }));

  tech.send({ type: "stage", layers: { show: { media: false } } });
  let s = await stageWhere(desk, (stage) => stage.layers?.hidden?.includes("media"));
  check("they hide a layer on every screen", !!s, JSON.stringify(s?.stage));
  tech.send({ type: "stage", layers: { screen: "scr_one", show: { overlays: false }, title: true } });
  s = await stageWhere(desk, (stage) => !!stage.layers?.screens?.scr_one);
  check("…and one screen's own, with the title card", s?.stage.layers.screens.scr_one.hidden.includes("overlays") && s.stage.layers.screens.scr_one.title === true, JSON.stringify(s?.stage.layers));
  tech.send({ type: "stage", layers: { clear: ["content"] } });
  s = await stageWhere(desk, (stage) => !!stage.layers?.cleared);
  check("…and clear the words until the next slide", s?.stage.layers.cleared.layers.includes("content"), JSON.stringify(s?.stage.layers));

  tech.drain();
  tech.send({ type: "stage", message: "Hello" });
  let e = await refusal(tech);
  check("routing isn't the message", e?.code === "forbidden", JSON.stringify(e));
  tech.send({ type: "stage", timer: { kind: "countdown", duration: 60 }, layers: { show: { media: true } } });
  e = await refusal(tech);
  check("…nor the timer, even with layers", e?.code === "forbidden", JSON.stringify(e));
  tech.send({ type: "command", id: `present-${stamp}`, op: { kind: "present", presenting: { itemId: items[0].id, slide: 1, black: false } } });
  e = await tech.next((m) => (m.type === "error" || m.type === "ack") && m.id === `present-${stamp}`);
  check("…nor presenting", e?.type === "error" && e.code === "forbidden", JSON.stringify(e));

  const { device: other, session: theirs } = await joined(guest, "guest");
  check("someone without the role doesn't route", theirs?.canRoute === false, JSON.stringify(theirs?.canRoute));
  other.send({ type: "stage", layers: { show: { media: true } } });
  e = await refusal(other);
  check("…and is refused", e?.code === "forbidden", JSON.stringify(e));

  // The operator runs the screens alone: only they route them.
  const { device: booth } = await joined(operator, "booth");
  booth.send({ type: "screens", control: "exclusive" });
  s = await tech.next((m) => m.type === "session" && m.session?.screens?.exclusive === true);
  check("the screens locked to the operator: the tech is told they don't route now", s?.canRoute === false, JSON.stringify(s?.canRoute));
  tech.drain();
  tech.send({ type: "stage", layers: { show: { media: true } } });
  e = await refusal(tech);
  check("…their layers are refused, naming who has them", e?.code === "forbidden" && e.message.includes("runs the screens"), JSON.stringify(e));
  desk.drain();
  desk.send({ type: "stage", layers: { show: { media: true } } });
  e = await refusal(desk);
  check("…the leader's too", e?.code === "forbidden", JSON.stringify(e));
  desk.send({ type: "stage", message: "Two minutes" });
  s = await stageWhere(booth, (stage) => stage.message?.text === "Two minutes");
  check("…though the leader still sends a message", !!s, JSON.stringify(s?.stage));
  booth.send({ type: "stage", layers: { show: { media: true } } });
  s = await stageWhere(booth, (stage) => !stage.layers?.hidden?.includes("media"));
  check("the operator routes them", !!s, JSON.stringify(s?.stage.layers));
  booth.send({ type: "screens", control: null });
  s = await tech.next((m) => m.type === "session" && !m.session?.screens);
  check("handed back: the tech routes again", s?.canRoute === true, JSON.stringify(s?.canRoute));
} finally {
  for (const device of devices) device.close();
}

finish();
