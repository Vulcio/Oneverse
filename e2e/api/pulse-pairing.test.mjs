// Oneverse Pulse paired like a screen (issue #320): it asks for a code as a Pulse, and whoever confirms it sees
// so; an organisation's admin pairs it to follow one of the organisation's locations, and it's on the set of the
// event on there now. Signed in by its own token it mirrors that set's session, gets the key its room's passes are
// checked with and tells the set's devices where it is - without being one of the set's screens or people. A
// screen can't; a location elsewhere is refused; its location removed, it has no set.
import { API, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

const admin = await user("Pulse pairing global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
const lead = await user("Pulse pairing lead");
const org = (await call(lead, "POST", "/organizations", { name: `Pulse church ${stamp}` })).body;
const music = (await call(lead, "POST", "/teams", { name: `Pulse music ${stamp}` })).body;
await call(lead, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
const other = (await call(lead, "POST", "/organizations", { name: `Elsewhere ${stamp}` })).body;
const church = (await call(lead, "POST", "/locations", { name: "Main campus", timeZone: "UTC", organizationId: org.id })).body;
const away = (await call(lead, "POST", "/locations", { name: "Not here", timeZone: "UTC", organizationId: other.id })).body;

// An event at the church, started a few minutes ago (UTC, the location's time zone).
const now = new Date();
const today = now.toISOString().slice(0, 10);
const started = new Date(Math.max(now.getTime() - 10 * 60_000, new Date(`${today}T00:00:00Z`).getTime())).toISOString().slice(11, 16);
const service = (await call(lead, "POST", `/organizations/${org.id}/events`, { title: "Service", date: today, startTime: started, timeZone: "UTC", hostUserId: lead.id, locationId: church.id, needs: [{ teamId: music.id }] })).body;
const dates = (await call(lead, "GET", `/teams/${music.id}/event-dates?from=${today}&to=${today}`)).body;
const setId = dates.find((date) => date.eventId === service.needs?.[0]?.teamEventId)?.setlistId;
check("the event at the church has today's set", !!setId, JSON.stringify(dates));

const pair = async (kind) => (await fetch(`${API}/screens/pairings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind ? { kind } : {}) })).json();

// --- pairing
const pulse = await pair("PULSE");
check("a Pulse asks for a code, without signing in", /^[A-Z2-9]{6}$/.test(pulse.code ?? ""), JSON.stringify(pulse));
let r = await call(lead, "GET", `/screens/pairings/${pulse.code}`);
check("whoever confirms it sees it's a Pulse", r.status === 200 && r.body.kind === "PULSE", JSON.stringify(r.body));
r = await call(lead, "POST", `/screens/pairings/${pulse.code}/confirm`, { name: "Stage Pulse", owner: { kind: "organization", id: org.id }, setMode: "LOCATION" });
check("following a location needs the location", r.status === 400 && r.body.message.some((m) => m.includes("locationId")), JSON.stringify(r.body));
r = await call(lead, "POST", `/screens/pairings/${pulse.code}/confirm`, { name: "Stage Pulse", owner: { kind: "organization", id: org.id }, setMode: "LOCATION", locationId: away.id });
check("…one of its owner's", r.status === 400 && r.body.message.some((m) => m.includes("locationId")), JSON.stringify(r.body));
r = await call(lead, "POST", `/screens/pairings/${pulse.code}/confirm`, { name: "Stage Pulse", owner: { kind: "organization", id: org.id }, setMode: "LOCATION", locationId: church.id });
const pulseId = r.body.id;
check("paired to the church: a Pulse on the set of the event on there now", r.status === 201 && r.body.kind === "PULSE" && r.body.setMode === "LOCATION" && r.body.location?.name === "Main campus" && r.body.setlistId === setId, JSON.stringify(r.body));
const claimed = (await call(lead, "POST", `/screens/pairings/${pulse.pairingId}/claim`, { secret: pulse.secret })).body;
check("it claims its token", claimed.token?.startsWith("scr_") && claimed.screen?.kind === "PULSE", JSON.stringify(claimed));
r = await call(lead, "GET", "/screens");
check("Screens lists it as a Pulse", r.body.some((one) => one.id === pulseId && one.kind === "PULSE"), JSON.stringify(r.body.map((one) => one.kind)));

const tv = await pair();
r = await call(lead, "GET", `/screens/pairings/${tv.code}`);
check("a screen's code says it's a screen", r.body.kind === "SCREEN", JSON.stringify(r.body));
const tvScreen = (await call(lead, "POST", `/screens/pairings/${tv.code}/confirm`, { name: "Lobby TV", owner: { kind: "organization", id: org.id }, setMode: "LOCATION", locationId: church.id })).body;
check("a screen can follow the location too", tvScreen.kind === "SCREEN" && tvScreen.setlistId === setId, JSON.stringify(tvScreen));
const tvToken = (await call(lead, "POST", `/screens/pairings/${tv.pairingId}/claim`, { secret: tv.secret })).body.token;

// --- in the set's session
const tablet = await syncDevice(lead);
const device = await syncDevice({ screenToken: claimed.token });
try {
  check("signed in by its token: told it's a Pulse, on the set", device.ready?.type === "screen" && device.ready.screen.pulse === true && device.ready.screen.setId === setId, JSON.stringify(device.ready));
  tablet.send({ type: "join", setId, deviceId: `tablet-${stamp}` });
  await tablet.next((m) => m.type === "session");
  tablet.send({ type: "command", id: `lead-${stamp}`, op: { kind: "lead" } });
  await tablet.next((m) => m.type === "ack" && m.id === `lead-${stamp}`);
  device.send({ type: "mirror", room: "http://192.168.1.20:8788" });
  const mirrored = await device.next((m) => m.type === "session" && m.live?.leader);
  check("it mirrors the set's session", !!mirrored, JSON.stringify(mirrored));
  device.send({ type: "pass" });
  const pass = await device.next((m) => m.type === "pass");
  check("…and gets the key its room's passes are checked with", pass?.setId === setId && typeof pass.key === "string" && pass.key.length > 20, JSON.stringify(pass));
  const told = await tablet.next((m) => m.type === "session" && m.pulse === "http://192.168.1.20:8788", 5000);
  check("the set's devices are told where it is; it isn't one of the set's people or screens", !!told && !told.members.some((member) => member.id === pulseId), JSON.stringify(told?.members));
  device.send({ type: "join", setId, deviceId: "nope-1234" });
  const refused = await device.next((m) => m.type === "error");
  check("…and does nothing else", refused?.code === "forbidden", JSON.stringify(refused));

  const screen = await syncDevice({ screenToken: tvToken });
  screen.send({ type: "mirror" });
  const no = await screen.next((m) => m.type === "error");
  check("a screen doesn't mirror", no?.code === "forbidden" && !screen.ready.screen.pulse, JSON.stringify(no));
  screen.close();

  // Its location removed: no event to follow.
  await call(lead, "DELETE", `/locations/${church.id}`);
  r = await call(lead, "GET", "/screens");
  const after = r.body.find((one) => one.id === pulseId);
  const current = await fetch(`${API}/screens/current`, { headers: { Authorization: `Screen ${claimed.token}` } }).then((res) => res.json());
  check("its location removed, it has no set", current.screen?.setlistId === null && current.screen.location === null, JSON.stringify({ after, current: current.screen }));
} finally {
  tablet.close();
  device.close();
}

finish();
