// Split control (issue #305): tempo keeps one leader, but what the screens
// present takes many controllers - the set's leader, someone with a role that
// runs screens, someone the leader hands it to live. A command says which
// revision of what's presented it was decided from; two people pressing Next
// together move the screens once, the second refused as stale. An operator
// can lock control to themselves, and give it back.
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

const admin = await user("Control admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const leader = await user("Singer");
const operator = await user("Desk");
const helper = await user("Helper");

const role = await api(admin, "POST", "/admin/roles", { name: `Screens ${stamp}`, canOperateScreens: true });
const listed = (await api(admin, "GET", "/admin/roles")).find((one) => one.id === role.id);
check("a role that runs the screens", listed?.canOperateScreens === true, JSON.stringify(listed));
await api(admin, "PUT", `/admin/users/${operator.id}/roles`, { roleIds: [role.id, "role_audio_uploads"] });

const set = await api(leader, "POST", "/setlists", { name: `Control ${stamp}` });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo\n\nThree\n\nFour" } });
const itemId = items[0].id;
// The operator and the helper open the set through its link: they can't edit it.
const token = (await api(leader, "POST", `/setlists/${set.id}/share-link`)).link.token;
for (const who of [operator, helper]) await call(who, "POST", `/set-invites/${token}/join`);

const devices = [];
async function joined(who) {
  const device = await syncDevice(who);
  devices.push(device);
  device.send({ type: "join", setId: set.id });
  return device;
}
const sessionWhere = (device, test, ms) => device.next((m) => m.type === "session" && test(m), ms);

try {
  const singer = await joined(leader);
  await sessionWhere(singer, () => true);
  singer.send({ type: "lead" });
  await sessionWhere(singer, (m) => m.leading);
  singer.send({ type: "present", presenting: { itemId, slide: 0, black: false }, basedOn: 0 });
  let s = await sessionWhere(singer, (m) => m.session?.presenting?.slide === 0);
  check("the leader presents: revision 1", s?.session.presentingRev === 1 && s.canPresent === true, JSON.stringify(s?.session));

  const desk = await joined(operator);
  s = await sessionWhere(desk, () => true);
  check("someone with the role may present, without leading or editing the set", s?.canPresent === true && s.canLead === false, JSON.stringify({ canPresent: s?.canPresent, canLead: s?.canLead }));
  const side = await joined(helper);
  s = await sessionWhere(side, () => true);
  check("a guest without it may not", s?.canPresent === false, String(s?.canPresent));
  side.send({ type: "present", presenting: { itemId, slide: 3, black: false }, basedOn: 1 });
  let e = await side.next((m) => m.type === "error");
  check("…their command is refused", e?.code === "forbidden", JSON.stringify(e));

  // Next, pressed at once by the singer and the desk, both from slide 0 (revision 1).
  singer.drain();
  desk.drain();
  singer.send({ type: "present", presenting: { itemId, slide: 1, black: false }, basedOn: 1 });
  desk.send({ type: "present", presenting: { itemId, slide: 1, black: false }, basedOn: 1 });
  s = await sessionWhere(singer, (m) => (m.session?.presentingRev ?? 0) >= 2);
  const refused = (await Promise.all([singer.next((m) => m.type === "error", 1500), desk.next((m) => m.type === "error", 1500)])).filter(Boolean);
  const after = await sessionWhere(desk, () => true, 1500);
  check("pressed together: the screens move once, to slide 2", s?.session.presenting.slide === 1 && s.session.presentingRev === 2 && (after?.session.presentingRev ?? 2) === 2, JSON.stringify(s?.session));
  check("…the second is refused as stale", refused.length === 1 && refused[0].code === "stale", JSON.stringify(refused));

  // The same Next, both from slide 2 but one of them a different slide: the first wins, the second is stale.
  desk.drain();
  desk.send({ type: "present", presenting: { itemId, slide: 2, black: false }, basedOn: 2 });
  await sessionWhere(desk, (m) => m.session?.presentingRev === 3);
  singer.drain();
  singer.send({ type: "present", presenting: { itemId, slide: 0, black: false }, basedOn: 2 });
  e = await singer.next((m) => m.type === "error");
  s = await sessionWhere(singer, () => true);
  check("a command from what's no longer shown is refused, and the session says what is", e?.code === "stale" && s?.session.presenting.slide === 2, JSON.stringify({ e, presenting: s?.session.presenting }));

  singer.drain();
  singer.send({ type: "present", presenting: { itemId, slide: 2, black: false }, basedOn: 3 });
  check("the same slide again changes nothing", (await singer.next((m) => m.type === "session", 800)) === null);
  singer.send({ type: "present", presenting: { itemId, slide: 3, black: false } });
  s = await sessionWhere(singer, (m) => m.session?.presenting?.slide === 3);
  check("a command that says nothing of its revision (an older client) is taken", s?.session.presentingRev === 4, JSON.stringify(s?.session));

  // The desk locks control to itself.
  desk.send({ type: "screens", control: "exclusive" });
  s = await sessionWhere(singer, (m) => m.session?.screens?.exclusive === true);
  check("the desk locks control: the singer's Live is told it can't present", s?.canPresent === false && s.session.screens.name === "Desk", JSON.stringify({ canPresent: s?.canPresent, screens: s?.session.screens }));
  singer.drain();
  singer.send({ type: "present", presenting: { itemId, slide: 0, black: false }, basedOn: 4 });
  e = await singer.next((m) => m.type === "error");
  check("…their commands are refused, naming who has it", e?.code === "forbidden" && e.message === "Desk runs the screens", JSON.stringify(e));
  singer.send({ type: "screens", control: "exclusive" });
  e = await singer.next((m) => m.type === "error");
  check("…nor can they lock it from under the desk", e?.code === "forbidden", JSON.stringify(e));
  desk.send({ type: "present", presenting: { itemId, slide: 0, black: true }, basedOn: 4 });
  s = await sessionWhere(desk, (m) => m.session?.presenting?.black === true);
  check("the desk still presents", s?.session.presentingRev === 5);

  // The desk's connection drops (a Wi-Fi blip): the lock waits for it rather than falling to the singer.
  singer.drain();
  desk.close();
  s = await sessionWhere(singer, (m) => m.session?.screens?.online === false);
  check("the desk drops: the screens stay locked to it, shown offline", s?.session.screens.exclusive === true && s.session.screens.name === "Desk" && s.canPresent === false, JSON.stringify({ screens: s?.session.screens, canPresent: s?.canPresent }));
  singer.drain();
  singer.send({ type: "present", presenting: { itemId, slide: 1, black: false }, basedOn: 5 });
  e = await singer.next((m) => m.type === "error");
  check("…the singer still can't move them meanwhile", e?.code === "forbidden" && e.message === "Desk runs the screens", JSON.stringify(e));
  const desk2 = await joined(operator);
  s = await sessionWhere(desk2, () => true);
  check("back on a new connection: the desk may present at once", s?.canPresent === true && s.screensMine === false, JSON.stringify({ canPresent: s?.canPresent, screensMine: s?.screensMine }));
  desk2.send({ type: "screens", control: "exclusive" });
  s = await sessionWhere(desk2, (m) => m.screensMine === true);
  check("…and takes the lock back, online again", s?.session.screens.exclusive === true && s.session.screens.online === undefined, JSON.stringify(s?.session.screens));

  // Leaving on purpose (closing the console) gives them back at once.
  singer.drain();
  desk2.send({ type: "leave" });
  s = await sessionWhere(singer, (m) => !m.session?.screens);
  check("the desk leaves the set: the singer presents again at once", s?.canPresent === true, String(s?.canPresent));
  const desk3 = await joined(operator);
  await sessionWhere(desk3, () => true);
  desk3.send({ type: "screens", control: "exclusive" });
  await sessionWhere(singer, (m) => m.session?.screens?.exclusive === true);
  desk3.send({ type: "screens", control: null });
  s = await sessionWhere(singer, (m) => !m.session?.screens);
  check("given back: the singer presents again", s?.canPresent === true, String(s?.canPresent));

  // Held by the device (issue #247): back on the same device within the lease, the lock is the desk's
  // again without asking; another account claiming the desk's device id isn't the desk.
  const deskDevice = `desk-${stamp}`;
  const desk4 = await syncDevice(operator);
  devices.push(desk4);
  desk4.send({ type: "join", setId: set.id, deviceId: deskDevice });
  await sessionWhere(desk4, () => true);
  desk4.send({ type: "screens", control: "exclusive" });
  await sessionWhere(desk4, (m) => m.screensMine === true);
  singer.drain();
  desk4.close();
  await sessionWhere(singer, (m) => m.session?.screens?.online === false);
  const impostor = await syncDevice(helper);
  devices.push(impostor);
  impostor.send({ type: "join", setId: set.id, deviceId: deskDevice });
  s = await sessionWhere(impostor, () => true);
  check("another account with the desk's device id isn't the desk", s?.screensMine === false && s.session.screens.online === false, JSON.stringify({ screensMine: s?.screensMine, screens: s?.session.screens }));
  impostor.close();
  const desk5 = await syncDevice(operator);
  devices.push(desk5);
  desk5.send({ type: "join", setId: set.id, deviceId: deskDevice });
  s = await sessionWhere(desk5, (m) => m.screensMine === true);
  check("the desk back on the same device: the lock is its own again, without asking", s?.session.screens.exclusive === true && s.session.screens.online === undefined, JSON.stringify(s?.session.screens));
  desk5.send({ type: "screens", control: null });
  await sessionWhere(singer, (m) => !m.session?.screens);

  // The leader hands presenting to the helper, live.
  side.send({ type: "presenter", userId: helper.id, allow: true });
  e = await side.next((m) => m.type === "error");
  check("only the leader hands it on", e?.code === "forbidden", JSON.stringify(e));
  singer.send({ type: "presenter", userId: helper.id, allow: true });
  s = await sessionWhere(side, (m) => m.canPresent === true);
  check("handed to the helper: they may present", s?.session.presenters?.some((one) => one.id === helper.id && one.name === "Helper"), JSON.stringify(s?.session.presenters));
  side.send({ type: "present", presenting: { itemId, slide: 1, black: false }, basedOn: 5 });
  s = await sessionWhere(singer, (m) => m.session?.presenting?.slide === 1);
  check("…and their Next moves the screens", s?.session.presentingRev === 6, JSON.stringify(s?.session));
  singer.send({ type: "presenter", userId: helper.id, allow: false });
  s = await sessionWhere(side, (m) => m.canPresent === false);
  check("taken back: they may not", !!s && !s.session.presenters?.length);
  singer.send({ type: "presenter", userId: admin.id, allow: true });
  e = await singer.next((m) => m.type === "error");
  check("only to someone in the set", e?.code === "bad-request" && e.message === "They're not in the set", JSON.stringify(e));
} finally {
  for (const device of devices) device.close();
  await call(admin, "DELETE", `/admin/roles/${role.id}`);
}
finish();
