// Passes to a set's session on Oneverse Pulse's page (issue #247, core's
// live/pass.ts): the cloud signs one for each person in the set, on their
// device, with what they may do there; Pulse checks it with the cloud's
// public key, offline.
import { api, call, check, finish, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";
import { verifyLivePass } from "../../packages/core/dist/index.js";

const leader = await user("Pass holder");
const guest = await user("Pass guest");
const set = await api(leader, "POST", "/setlists", { name: `Passes ${stamp}` });
const other = await api(leader, "POST", "/setlists", { name: `Other passes ${stamp}` });
const token = (await api(leader, "POST", `/setlists/${set.id}/share-link`)).link.token;
await call(guest, "POST", `/set-invites/${token}/join`);

const devices = [];
async function passFor(who, name) {
  const device = await syncDevice(who);
  devices.push(device);
  device.send({ type: "join", setId: set.id, deviceId: `${name}-${stamp}` });
  await device.next((m) => m.type === "session");
  device.send({ type: "pass" });
  return device.next((m) => m.type === "pass" || m.type === "error");
}

try {
  const outside = await syncDevice(leader);
  devices.push(outside);
  outside.send({ type: "pass" });
  const refused = await outside.next((m) => m.type === "error");
  check("not before joining a set", refused?.code === "bad-request", JSON.stringify(refused));

  const mine = await passFor(leader, "tablet");
  const now = Date.now();
  const payload = await verifyLivePass(mine.pass, mine.key, set.id, now);
  check(
    "a pass the cloud signed: who, on which device, what they may do",
    payload?.sub === leader.id && payload.device === `d:${leader.id}:tablet-${stamp}` && payload.canLead === true && payload.exp === mine.expiresAt,
    JSON.stringify(payload),
  );
  check("for some hours", mine.expiresAt - now > 11 * 3600_000 && mine.expiresAt - now <= 12 * 3600_000 + 5000);
  check("not for another set", (await verifyLivePass(mine.pass, mine.key, other.id, now)) === null);
  check("not after it expires", (await verifyLivePass(mine.pass, mine.key, set.id, mine.expiresAt)) === null);

  const theirs = await passFor(guest, "phone");
  const guestPayload = await verifyLivePass(theirs.pass, theirs.key, set.id, Date.now());
  check("someone who can't edit the set: a pass that says so", guestPayload?.sub === guest.id && guestPayload.canLead === false, JSON.stringify(guestPayload));
  check("one key for every pass", theirs.key === mine.key);
} finally {
  for (const device of devices) device.close();
}

finish();
