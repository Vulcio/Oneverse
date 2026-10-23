// Oneverse Pulse's room (issue #247, apps/pulse/src/room.ts): a device that
// got a pass from the cloud enters Pulse's own /sync with it, offline, and
// runs the session there with the rights the pass says; the room's changes
// reach the cloud when it's back. Here Pulse's link and room run in this
// process, the link's connection to the API cut and restored on demand.
import { createServer } from "node:http";
import { API, api, call, check, finish, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";
import { pairPulse } from "../lib/pulse.mjs";
import { CloudLink } from "../../apps/pulse/dist/cloud-link.js";
import { Room } from "../../apps/pulse/dist/room.js";
import { SetCopy } from "../../apps/pulse/dist/set-copy.js";

const leader = await user("Room host");
const guest = await user("Room visitor");
const set = await api(leader, "POST", "/setlists", { name: `Pulse room ${stamp}` });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo\n\nThree" } });
const itemId = items[0].id;
// Pulse, paired to show the set (issue #320).
const pulseToken = await pairPulse(leader, set.id);
const token = (await api(leader, "POST", `/setlists/${set.id}/share-link`)).link.token;
await call(guest, "POST", `/set-invites/${token}/join`);
const slide = (n) => ({ itemId, slide: n, black: false });
const until = async (test, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 100))) if (test()) return true;
  return false;
};

let down = false;
let current = null;
const link = new CloudLink({
  apiUrl: API,
  nodeId: `pulse-room-${stamp}`,
  token: async () => pulseToken,
  outageMs: 1500,
  open: (url) => {
    if (down) {
      const dead = { readyState: 3, send() {}, close() {}, onopen: null, onmessage: null, onclose: null };
      setTimeout(() => dead.onclose?.(), 50);
      return dead;
    }
    current = new WebSocket(url);
    return current;
  },
});
const copy = new SetCopy({ apiUrl: API, token: async () => pulseToken });
const server = createServer(async (request, response) => {
  if (!(await room.handle(request, response))) response.writeHead(404).end();
});
const room = new Room(server, link, copy);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const ROOM = `ws://127.0.0.1:${server.address().port}/sync`;
const ROOM_HTTP = `http://127.0.0.1:${server.address().port}`;

/** A device on Pulse's /sync. */
async function roomDevice() {
  const ws = new WebSocket(ROOM);
  const messages = [];
  const waiting = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const w = waiting.find((one) => one.match(message));
    if (w) {
      waiting.splice(waiting.indexOf(w), 1);
      w.resolve(message);
    } else messages.push(message);
  };
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
  const next = (match, ms = 3000) =>
    new Promise((resolve) => {
      const early = messages.findIndex(match);
      if (early >= 0) return resolve(messages.splice(early, 1)[0]);
      const w = { match, resolve };
      waiting.push(w);
      setTimeout(() => waiting.includes(w) && (waiting.splice(waiting.indexOf(w), 1), resolve(null)), ms);
    });
  return { next, send: (message) => ws.send(JSON.stringify(message)), close: () => ws.close() };
}

const cloudDevices = [];
async function passFor(who, name) {
  const device = await syncDevice(who);
  cloudDevices.push(device);
  device.send({ type: "join", setId: set.id, deviceId: `${name}-${stamp}` });
  await device.next((m) => m.type === "session");
  device.send({ type: "pass" });
  return { device, pass: (await device.next((m) => m.type === "pass")).pass };
}

const roomDevices = [];
try {
  const tablet = await passFor(leader, "tablet");
  tablet.device.send({ type: "command", id: `lead-${stamp}`, op: { kind: "lead" } });
  tablet.device.send({ type: "command", id: `one-${stamp}`, op: { kind: "present", presenting: slide(1), basedOn: 0 } });
  await tablet.device.next((m) => m.type === "ack" && m.id === `one-${stamp}`);
  const phone = await passFor(guest, "phone");

  link.start();
  check("Pulse online, with the cloud's key", await until(() => link.status === "online" && !!link.passKey && link.engine.state?.presenting?.slide === 1));

  const stranger = await roomDevice();
  roomDevices.push(stranger);
  stranger.send({ type: "enter", pass: `${tablet.pass.split(".")[0]}.forged` });
  const refused = await stranger.next((m) => m.type === "error");
  check("a pass the cloud didn't sign: not let in", refused?.code === "unauthorized", JSON.stringify(refused));
  stranger.send({ type: "join", setId: set.id });
  check("…nor into the set", (await stranger.next((m) => m.type === "error"))?.code === "unauthorized");

  check("Pulse keeps a copy of the set", (await copy.refresh()) && copy.current?.songs.length === 1);
  const noPass = await fetch(`${ROOM_HTTP}/set`);
  check("…not given to someone without a pass", noPass.status === 401, String(noPass.status));

  down = true;
  current.close();
  check("the cloud gone: the room runs the session", await until(() => link.status === "room"));

  // The tablet's page continues on Pulse with its pass.
  const roomTablet = await roomDevice();
  roomDevices.push(roomTablet);
  roomTablet.send({ type: "enter", pass: tablet.pass });
  const ready = await roomTablet.next((m) => m.type === "ready");
  check("entered with the cloud's pass, offline", ready?.userId === leader.id, JSON.stringify(ready));
  roomTablet.send({ type: "join", setId: set.id, deviceId: `tablet-${stamp}` });
  const inRoom = await roomTablet.next((m) => m.type === "session");
  check("in the set: the session as the room runs it, still led from this device", inRoom?.session?.epoch === link.engine.state.epoch && inRoom.leading === true, JSON.stringify(inRoom));
  const epoch = link.engine.state.epoch;
  roomTablet.send({ type: "command", id: `room-${stamp}`, epoch, op: { kind: "present", presenting: slide(2), basedOn: inRoom.session.presentingRev } });
  const ack = await roomTablet.next((m) => m.type === "ack" || m.type === "error");
  check("the room's Next: applied by Pulse", ack?.type === "ack", JSON.stringify(ack));
  check("…and the room hears it", !!(await roomTablet.next((m) => m.type === "session" && m.session?.presenting?.slide === 2)));

  const kept = await fetch(`${ROOM_HTTP}/set`, { headers: { authorization: `Pass ${tablet.pass}` } });
  const body = kept.ok ? await kept.json() : null;
  check("offline, the set's copy from Pulse, to a pass, without anyone's notes", body?.songs?.[0]?.item.id === itemId && Object.keys(body.notes).length === 0, String(kept.status));

  // The guest, who can't edit the set, can't move the screens in the room either.
  const roomPhone = await roomDevice();
  roomDevices.push(roomPhone);
  roomPhone.send({ type: "enter", pass: phone.pass });
  await roomPhone.next((m) => m.type === "ready");
  roomPhone.send({ type: "join", setId: set.id, deviceId: `phone-${stamp}` });
  await roomPhone.next((m) => m.type === "session");
  roomPhone.send({ type: "command", id: `guest-${stamp}`, op: { kind: "present", presenting: slide(3) } });
  const guestAnswer = await roomPhone.next((m) => m.type === "ack" || m.type === "error");
  check("someone who may not, by their pass: refused in the room too", guestAnswer?.type === "error" && guestAnswer.code === "forbidden", JSON.stringify(guestAnswer));

  down = false;
  check("back: the cloud takes the room's session", await until(() => link.status === "online" && !link.engine.runs));
  const after = await tablet.device.next((m) => m.type === "session" && m.session?.epoch === epoch + 1, 5000);
  check("the room's slide is the cloud's", after?.session.presenting?.slide === 2, JSON.stringify(after?.session));
} finally {
  for (const device of [...roomDevices, ...cloudDevices]) device.close();
  room.close();
  server.close();
  link.stop();
}

finish();
