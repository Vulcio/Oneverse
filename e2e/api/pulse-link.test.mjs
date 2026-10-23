// Oneverse Pulse's link to the cloud (issue #247, apps/pulse): the process on
// the mini PC mirrors a set's session; the cloud gone past OUTAGE_MS, the room
// runs it; back, the room's session goes to the cloud first, which takes it,
// and Pulse mirrors again. Here the link runs in this process, its connection
// to the API cut and restored on demand.
import { API, api, check, finish, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";
import { pairPulse } from "../lib/pulse.mjs";
import { CloudLink } from "../../apps/pulse/dist/cloud-link.js";

const leader = await user("Pulse owner");
const set = await api(leader, "POST", "/setlists", { name: `Pulse link ${stamp}` });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo\n\nThree" } });
const itemId = items[0].id;
// Pulse, paired to show the set (issue #320).
const pulseToken = await pairPulse(leader, set.id);
const slide = (n) => ({ itemId, slide: n, black: false });
const until = async (test, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 100))) if (test()) return true;
  return false;
};

// The internet, as Pulse sees it: while it's down, every connection fails at once.
let down = false;
let current = null;
const link = new CloudLink({
  apiUrl: API,
  nodeId: `pulse-${stamp}`,
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

const tablet = await syncDevice(leader);
try {
  tablet.send({ type: "join", setId: set.id, deviceId: `tablet-${stamp}` });
  await tablet.next((m) => m.type === "session");
  tablet.send({ type: "command", id: `lead-${stamp}`, op: { kind: "lead" } });
  tablet.send({ type: "command", id: `one-${stamp}`, op: { kind: "present", presenting: slide(1), basedOn: 0 } });
  await tablet.next((m) => m.type === "ack" && m.id === `one-${stamp}`);

  link.start();
  check("online: Pulse mirrors the session", await until(() => link.status === "online" && link.engine.state?.presenting?.slide === 1), link.status);

  down = true;
  current.close();
  check("the cloud gone past the outage: the room runs the session", await until(() => link.status === "room"), link.status);
  const epoch = link.engine.state.epoch;
  const answer = link.engine.command(
    { userId: leader.id, name: leader.name, device: `d:${leader.id}:tablet-${stamp}`, canLead: true, canOperate: false },
    { id: `room-${stamp}`, epoch, op: { kind: "present", presenting: slide(2), basedOn: link.engine.state.presentingRev } },
  );
  check("the room's Next, on Pulse", answer.type === "ack", JSON.stringify(answer));

  down = false;
  check("back: the cloud takes the room's session, and Pulse mirrors again", await until(() => link.status === "online" && !link.engine.runs), link.status);
  const after = await tablet.next((m) => m.type === "session" && m.session?.epoch === epoch + 1, 5000);
  check("the room's slide is the cloud's now", after?.session.presenting?.slide === 2, JSON.stringify(after?.session));
  check("…and Pulse mirrors it", await until(() => link.engine.state?.epoch === epoch + 1 && link.engine.state?.presenting?.slide === 2));
} finally {
  link.stop();
  tablet.close();
}

finish();
