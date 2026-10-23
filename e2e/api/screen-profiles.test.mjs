// Screen profiles and temporary pairing (issue #284): a pairing lasts 12
// hours, a day, a week or until it's disconnected; extended from Screens; once
// it has ended its token stops working (current, /sync) and it's gone from
// Screens. A screen already paired shows a code again when its manager asks,
// for someone else to pair it to a profile of their own - not a Pulse.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

const owner = await user("Profiles owner");
const member = await user("Profiles member");
const guest = await user("Profiles guest");
const team = await api(owner, "POST", "/teams", { name: `Profiles band ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('tmprof${stamp}', '${team.id}', '${member.id}', 'MEMBER', now())`);

async function anonymous(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
/** A screen paired by `who` with `body`: the screen as Screens has it, and its token. */
async function paired(who, body, kind) {
  const pairing = (await anonymous("POST", "/screens/pairings", kind ? { kind } : undefined)).body;
  const confirmed = await call(who, "POST", `/screens/pairings/${pairing.code}/confirm`, { mode: "LYRICS", setMode: "DAY", ...body });
  const token = (await anonymous("POST", `/screens/pairings/${pairing.pairingId}/claim`, { secret: pairing.secret })).body?.token;
  return { ...confirmed, token };
}
const hours = (iso) => (new Date(iso).getTime() - Date.now()) / 3600_000;

const devices = [];
try {
  // --- how long it lasts
  let r = await paired(owner, { name: `Lobby ${stamp}`, owner: { kind: "team", id: team.id }, lasts: "12h" });
  check("paired for 12 hours: it ends in 12 hours", r.status === 201 && hours(r.body.expiresAt) > 11.9 && hours(r.body.expiresAt) <= 12, JSON.stringify(r.body?.expiresAt));
  const lobby = r.body;
  const lobbyToken = r.token;
  r = await paired(owner, { name: `Hall ${stamp}` });
  check("left out: unlimited", r.status === 201 && r.body.expiresAt === null, JSON.stringify(r.body?.expiresAt));
  const hall = r.body;
  const hallToken = r.token;
  r = await call(owner, "POST", "/screens/pairings/AAAAAA/confirm", { name: "x", setMode: "DAY", lasts: "1y" });
  check("a length it doesn't know: refused by name", r.status === 400 && JSON.stringify(r.body.message).includes("lasts"), JSON.stringify(r.body));
  r = await call(owner, "GET", "/screens");
  check("Screens says when it ends", r.body.find((one) => one.id === lobby.id)?.expiresAt === lobby.expiresAt);

  // --- extended
  r = await call(owner, "PATCH", `/screens/${lobby.id}`, { lasts: "1w" });
  check("extended by a week, from now", r.status === 200 && hours(r.body.expiresAt) > 7 * 24 - 0.1, JSON.stringify(r.body?.expiresAt));
  r = await call(member, "PATCH", `/screens/${lobby.id}`, { lasts: "unlimited" });
  check("a member who doesn't manage it doesn't extend it", r.status === 403, String(r.status));
  r = await call(owner, "PATCH", `/screens/${lobby.id}`, { lasts: "1d" });
  check("…its manager does", r.status === 200 && hours(r.body.expiresAt) > 23.9, JSON.stringify(r.body?.expiresAt));

  // --- shown a code again
  const tv = await syncDevice({ screenToken: hallToken });
  devices.push(tv);
  check("the screen signs in", tv.ready?.type === "screen", JSON.stringify(tv.ready));
  r = await call(guest, "POST", `/screens/${hall.id}/pair-again`);
  check("someone else doesn't make it show a code", r.status === 404, String(r.status));
  r = await call(owner, "POST", `/screens/${hall.id}/pair-again`);
  check("its manager does", r.status === 204, String(r.status));
  check("…the screen is told to show one", !!(await tv.next((m) => m.type === "pair-again")));
  r = await paired(guest, { name: `Guest profile ${stamp}`, lasts: "12h" });
  check("someone else pairs it to their own profile, temporarily", r.status === 201 && r.body.owner.kind === "user" && !!r.body.expiresAt, JSON.stringify(r.body));
  const guestProfile = r.body;
  r = await anonymous("GET", "/screens/current", null, { Authorization: `Screen ${hallToken}` });
  check("…and the first profile still works", r.status === 200 && r.body.screen.id === hall.id, String(r.status));
  r = await call(owner, "GET", "/screens");
  check("each owner sees only their own profile", !r.body.some((one) => one.id === guestProfile.id) && (await call(guest, "GET", "/screens")).body.some((one) => one.id === guestProfile.id));
  const pulse = await paired(owner, { name: `Pulse ${stamp}` }, "PULSE");
  r = await call(owner, "POST", `/screens/${pulse.body.id}/pair-again`);
  check("a Pulse isn't paired again", r.status === 400, String(r.status));

  // --- ended
  sql(`update "Screen" set "expiresAt" = now() - interval '1 minute' where id = '${lobby.id}'`);
  r = await call(owner, "GET", "/screens");
  check("ended: gone from Screens", r.status === 200 && !r.body.some((one) => one.id === lobby.id));
  r = await call(owner, "PATCH", `/screens/${lobby.id}`, { lasts: "1w" });
  check("…not extended after it ended", r.status === 404, String(r.status));
  const late = await syncDevice({ screenToken: lobbyToken });
  devices.push(late);
  check("…its token is refused by /sync", late.ready?.type === "error" && late.ready.code === "disconnected", JSON.stringify(late.ready));
  r = await anonymous("GET", "/screens/current", null, { Authorization: `Screen ${lobbyToken}` });
  check("…and by current: the screen shows a new code", r.status === 404, String(r.status));
  check("…and it's deleted", sql(`select count(*) from "Screen" where id = '${lobby.id}'`).trim() === "0");
} finally {
  for (const device of devices) device.close();
}

finish();
