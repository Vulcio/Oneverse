// Oneverse Pulse offline and back (issue #247, docs/live-session.md): Pulse
// mirrors a set's session while the cloud runs it; when the internet goes it
// runs it in the room, one epoch up (LiveEngine, the same reducer); when it's
// back it hands the room's state and record to the cloud, which takes them as
// they are - the room wins - and refuses what a device decided in the old
// epoch. Here Pulse's engine runs in this process, as it will in Pulse's Node.
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";
import { LiveEngine } from "../../packages/core/dist/index.js";

const leader = await user("Room lead");
const guest = await user("Room guest");
const set = await api(leader, "POST", "/setlists", { name: `Handback ${stamp}` });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo\n\nThree\n\nFour" } });
const itemId = items[0].id;
const token = (await api(leader, "POST", `/setlists/${set.id}/share-link`)).link.token;
await call(guest, "POST", `/set-invites/${token}/join`);

const devices = [];
async function joined(who, name) {
  const device = await syncDevice(who);
  devices.push(device);
  device.send({ type: "join", setId: set.id, deviceId: `${name}-${stamp}` });
  await device.next((m) => m.type === "session");
  return device;
}
const answer = (device, id) => device.next((m) => (m.type === "ack" || m.type === "error") && m.id === id);
const slide = (n) => ({ itemId, slide: n, black: false });

try {
  const tablet = await joined(leader, "tablet");
  tablet.send({ type: "command", id: `lead-${stamp}`, op: { kind: "lead" } });
  await answer(tablet, `lead-${stamp}`);
  tablet.send({ type: "command", id: `one-${stamp}`, op: { kind: "present", presenting: slide(1), basedOn: 0 } });
  await answer(tablet, `one-${stamp}`);

  const onlooker = await joined(guest, "onlooker");
  onlooker.send({ type: "mirror" });
  const refused = await onlooker.next((m) => m.type === "error");
  check("mirroring: not for someone who can't edit the set", refused?.code === "forbidden", JSON.stringify(refused));

  const pulse = await joined(leader, "pulse");
  pulse.send({ type: "mirror" });
  const mirrored = await pulse.next((m) => m.type === "session" && m.live?.presenting?.slide === 1);
  check("Pulse mirrors the session as it's kept, holders' devices and all", mirrored?.live?.leader.device === `d:${leader.id}:tablet-${stamp}`, JSON.stringify(mirrored?.live));
  const { sessionId, epoch } = mirrored.live;

  // The internet goes: the room runs it.
  const engine = new LiveEngine("node1");
  engine.mirror(mirrored.live);
  check("taken over in the room, one epoch up", engine.takeOver() && engine.state.epoch === epoch + 1 && engine.state.authority === "pulse:node1");
  const roomTablet = { userId: leader.id, name: leader.name, device: `d:${leader.id}:tablet-${stamp}`, canLead: true, canOperate: false };
  const roomNext = engine.command(roomTablet, { id: `room-${stamp}`, epoch: epoch + 1, op: { kind: "present", presenting: slide(2), basedOn: engine.state.presentingRev } });
  check("the room's Next, applied there", roomNext.type === "ack" && engine.state.presenting.slide === 2, JSON.stringify(roomNext));

  // Meanwhile a phone still reaching the cloud moves it on there.
  const phone = await joined(leader, "phone");
  // The cloud's session where Pulse last had it: the room's went on from there too.
  const cloudAt = mirrored.live;
  phone.send({ type: "command", id: `cloud-${stamp}`, epoch, op: { kind: "present", presenting: slide(3), basedOn: cloudAt.presentingRev } });
  const cloudNext = await answer(phone, `cloud-${stamp}`);
  check("the cloud keeps taking commands meanwhile", cloudNext?.type === "ack", JSON.stringify(cloudNext));

  // Back: Pulse hands the room's session back.
  pulse.send({ type: "handback", handback: engine.handBack() });
  const back = await pulse.next((m) => m.type === "handedBack" || m.type === "error", 5000);
  check("handed back: the cloud runs it again, one more epoch up", back?.type === "handedBack" && back.sessionId === sessionId && back.epoch === epoch + 2, JSON.stringify(back));
  const after = await phone.next((m) => m.type === "session" && m.session?.epoch === epoch + 2, 5000);
  check("the room wins: what it showed, past every revision either side reached", after?.session.presenting?.slide === 2 && after.session.rev > cloudAt.rev + 1, JSON.stringify(after?.session));

  phone.send({ type: "command", id: `late-${stamp}`, epoch, op: { kind: "present", presenting: slide(4), basedOn: cloudAt.presentingRev + 1 } });
  const late = await answer(phone, `late-${stamp}`);
  check("a command decided in the old epoch: refused, to load it again", late?.type === "error" && late.code === "epoch", JSON.stringify(late));

  pulse.send({ type: "handback", handback: engine.handBack() });
  const twice = await pulse.next((m) => m.type === "handedBack" || m.type === "error", 5000);
  check("not taken back twice", twice?.type === "error" && twice.code === "stale", JSON.stringify(twice));
  engine.handedBack();

  check("the session's row: the cloud's, at the new epoch", sql(`select epoch || ' ' || authority from "LiveSession" where id = '${sessionId}'`) === `${epoch + 2} cloud`);

  // The record: the room's change beside the cloud's, each with its epoch and origin.
  const admin = await user("Room recorder");
  sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
  const roomRecord = () => sql(`select count(*) from "LiveSessionCommand" where "sessionId" = '${sessionId}' and origin = 'pulse:node1' and epoch = ${epoch + 1} and "deviceId" = 'd:${leader.id}:tablet-${stamp}'`);
  let found = "0";
  for (let i = 0; i < 40 && found !== "1"; i++) {
    if (i % 10 === 0) await api(admin, "POST", "/admin/jobs/run/record-live-sessions");
    await new Promise((resolve) => setTimeout(resolve, 500));
    found = roomRecord();
  }
  check("the room's change in the record, with its epoch and origin", found === "1", found);
  check("…beside the cloud's, at the same revision in its own epoch", sql(`select count(*) from "LiveSessionCommand" where "sessionId" = '${sessionId}' and origin = 'cloud' and rev = ${roomNext.rev}`) === "1");
} finally {
  for (const device of devices) device.close();
}

finish();
