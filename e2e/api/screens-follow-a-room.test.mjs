// Screens follow a room (issue #566): a screen following a venue is in one of its rooms - it shows the events taking
// that room, not the others there - or the whole venue. A screen on wheels is a resource: booked for an event, it
// shows that event while it's held (from an hour before), wherever it is, then goes back to its room.
import { API, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Room screens global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const lead = await user("Room screens lead");
const org = (await call(lead, "POST", "/organizations", { name: `Room screens church ${stamp}` })).body;
const team = (await call(lead, "POST", "/teams", { name: `Room screens team ${stamp}` })).body;
await call(lead, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });
const other = (await call(lead, "POST", "/organizations", { name: `Room screens elsewhere ${stamp}` })).body;
const campus = (await call(lead, "POST", "/locations", { name: "Campus", timeZone: "UTC", organizationId: org.id })).body;
const away = (await call(lead, "POST", "/locations", { name: "Away", timeZone: "UTC", organizationId: other.id })).body;
const roomOf = async (location, name) => (await call(lead, "POST", `/locations/${location.id}/rooms`, { name })).body.rooms.find((room) => room.name === name);
const hall = await roomOf(campus, "Main hall");
const kids = await roomOf(campus, "Kids room");
const awayRoom = await roomOf(away, "Away room");
const trolley = (await call(lead, "POST", "/resources", { name: "Rolling TV", organizationId: org.id })).body;
const foreign = (await call(lead, "POST", "/resources", { name: "Their TV", organizationId: other.id })).body;

// Events on now (UTC, the venue's time zone): one in each room, and one taking the screen on wheels, at no venue.
const now = new Date();
const today = now.toISOString().slice(0, 10);
const started = new Date(Math.max(now.getTime() - 10 * 60_000, new Date(`${today}T00:00:00Z`).getTime())).toISOString().slice(11, 16);
const event = async (title, extra) => (await call(lead, "POST", `/teams/${team.id}/events`, { title, date: today, startTime: started, durationMinutes: 120, timeZone: "UTC", ...extra })).body;
const service = await event("Service", { locationId: campus.id, roomIds: [hall.id] });
const club = await event("Kids club", { locationId: campus.id, roomIds: [kids.id] });
const talk = await event("Talk next door", { resources: [{ resourceId: trolley.id }] });
const dates = (await call(lead, "GET", `/teams/${team.id}/event-dates?from=${today}&to=${today}`)).body;
const setOf = (one) => dates.find((date) => date.eventId === one.id)?.setlistId;
check("each event has today's set", !!setOf(service) && !!setOf(club) && !!setOf(talk), JSON.stringify(dates));

const pair = async () => (await fetch(`${API}/screens/pairings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })).json();
const confirm = async (name, extra) => call(lead, "POST", `/screens/pairings/${(await pair()).code}/confirm`, { name, owner: { kind: "organization", id: org.id }, setMode: "LOCATION", locationId: campus.id, ...extra });

// --- in a room
let r = await confirm("Hall TV", { roomId: hall.id });
const hallTv = r.body;
check("paired in the main hall: on the service, not the kids club", r.status === 201 && hallTv.room?.name === "Main hall" && hallTv.setlistId === setOf(service), JSON.stringify(r.body));
r = await confirm("Kids TV", { roomId: kids.id });
const kidsTv = r.body;
check("in the kids room: on the kids club", r.status === 201 && kidsTv.setlistId === setOf(club), JSON.stringify(r.body));
r = await confirm("Wrong room", { roomId: awayRoom.id });
check("…only a room of the venue it follows", r.status === 400 && r.body.message.some((m) => m.includes("roomId")), JSON.stringify(r.body));
r = await call(lead, "PATCH", `/screens/${kidsTv.id}`, { roomId: hall.id });
check("moved to the main hall: on the service", r.status === 200 && r.body.room?.id === hall.id && r.body.setlistId === setOf(service), JSON.stringify(r.body));
r = await call(lead, "PATCH", `/screens/${kidsTv.id}`, { roomId: kids.id });
check("…and back", r.body.setlistId === setOf(club), JSON.stringify(r.body));

// --- an event taking no room is the whole venue's: every room's screens show it
const lobby = (await call(lead, "POST", "/locations", { name: "Lobby venue", timeZone: "UTC", organizationId: org.id })).body;
const foyer = await roomOf(lobby, "Foyer");
const open = await event("Open house", { locationId: lobby.id });
const foyerTv = (await confirm("Foyer TV", { locationId: lobby.id, roomId: foyer.id })).body;
const openSet = (await call(lead, "GET", `/teams/${team.id}/event-dates?from=${today}&to=${today}`)).body.find((date) => date.eventId === open.id)?.setlistId;
check("an event booking no room shows in every room", !!openSet && foyerTv.setlistId === openSet, JSON.stringify(foyerTv));

// --- the whole venue
r = await call(lead, "PATCH", `/screens/${hallTv.id}`, { roomId: null });
check("the whole venue: no room, on one of its events", r.body.room === null && [setOf(service), setOf(club)].includes(r.body.setlistId), JSON.stringify(r.body));
r = await call(lead, "PATCH", `/screens/${hallTv.id}`, { roomId: hall.id });
r = await call(lead, "PATCH", `/screens/${hallTv.id}`, { locationId: lobby.id });
check("another venue leaves its room behind", r.status === 200 && r.body.room === null && r.body.location?.id === lobby.id, JSON.stringify(r.body));

// --- a screen on wheels
r = await call(lead, "PATCH", `/screens/${kidsTv.id}`, { resourceId: foreign.id });
check("on wheels: only one of its owner's resources", r.status === 400 && r.body.message.some((m) => m.includes("resourceId")), JSON.stringify(r.body));
r = await call(lead, "PATCH", `/screens/${kidsTv.id}`, { resourceId: trolley.id });
check("the rolling TV, booked for the talk now: it shows the talk", r.status === 200 && r.body.resource?.name === "Rolling TV" && r.body.setlistId === setOf(talk), JSON.stringify(r.body));
r = await call(lead, "PATCH", `/screens/${hallTv.id}`, { resourceId: trolley.id });
check("…one screen per resource", r.status === 400 && r.body.message.some((m) => m.includes("another screen")), JSON.stringify(r.body));
r = await call(lead, "PATCH", `/teams/${team.id}/events/${talk.id}`, { resources: [] });
check("the talk gives it up", r.status === 200, JSON.stringify(r.body));
r = await call(lead, "PATCH", `/screens/${kidsTv.id}`, { name: "Kids TV" });
check("…and it's back in its room, on the kids club", r.body.setlistId === setOf(club) && r.body.resource?.id === trolley.id, JSON.stringify(r.body));
r = await call(lead, "PATCH", `/screens/${kidsTv.id}`, { resourceId: null });
check("no longer on wheels", r.status === 200 && r.body.resource === null, JSON.stringify(r.body));

finish();
