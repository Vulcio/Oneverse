// An organisation's groups (issue #241): its admins make groups that only
// plan (a welcome team) or use Songverse, under one another; a group that
// only plans owns no songs, songbooks or sets and isn't among Songverse's
// teams; each group has positions of its own that its members say they
// cover; a group's admins make sub-groups under it (issue #245); a team
// leaving the organisation is a Songverse team again.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const admin = await user("groups global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("groups alice");
const bob = await user("groups bob");
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
const org = (await call(alice, "POST", "/organizations", { name: `Groups church ${stamp}` })).body;
const other = (await call(bob, "POST", "/organizations", { name: `Other church ${stamp}` })).body;
const music = (await call(alice, "POST", "/teams", { name: `Music ${stamp}` })).body;
await call(alice, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
const orgLink = (await call(alice, "POST", `/organizations/${org.id}/invite-links`, {})).body;
await call(bob, "POST", `/organizations/join/${orgLink.token}`);
const bobsTeam = (await call(bob, "POST", "/teams", { name: `Elsewhere ${stamp}` })).body;
await call(bob, "PUT", `/teams/${bobsTeam.id}/organization`, { organizationId: other.id });

// --- making groups
let r = await call(bob, "POST", `/organizations/${org.id}/groups`, { name: "Not mine" });
check("only the organisation's admins make groups", r.status === 403, String(r.status));
r = await call(alice, "POST", `/organizations/${org.id}/groups`, { name: `Welcome ${stamp}` });
const welcome = r.body;
check("a group that only plans, by default: run by who made it, in the organisation", r.status === 201 && welcome.usesSongverse === false && welcome.currentUserRole === "ADMIN" && welcome.organization?.id === org.id, JSON.stringify(r.body));
r = await call(alice, "POST", `/organizations/${org.id}/groups`, { name: `Choir ${stamp}`, usesSongverse: true, parentId: music.id });
const choir = r.body;
check("a Songverse group under another", r.status === 201 && choir.usesSongverse === true && choir.parentId === music.id, JSON.stringify(r.body));
r = await call(alice, "POST", `/organizations/${org.id}/groups`, { name: "Astray", parentId: bobsTeam.id });
check("under a group of another organisation: refused", r.status === 400, JSON.stringify(r.body));
let teams = (await call(alice, "GET", "/teams")).body;
check("Songverse's teams: not the group that only plans", teams.some((t) => t.id === choir.id) && !teams.some((t) => t.id === welcome.id), teams.map((t) => t.name).join());
teams = (await call(alice, "GET", "/teams?all=true")).body;
check("…all of them, when asked", teams.some((t) => t.id === welcome.id && t.usesSongverse === false), teams.map((t) => t.name).join());
r = await call(alice, "GET", `/organizations/${org.id}`);
check("the organisation shows its groups, which is under which", r.body.teams.find((t) => t.id === choir.id)?.parentId === music.id && r.body.teams.find((t) => t.id === welcome.id)?.usesSongverse === false, JSON.stringify(r.body.teams));

// --- what a group that only plans can't have
r = await call(alice, "POST", "/setlists", { name: "Coffee rota", teamId: welcome.id });
check("no sets", r.status === 400, JSON.stringify(r.body));
r = await call(alice, "POST", "/songbooks", { name: "Welcome songs", kind: "SIMPLE", teamId: welcome.id });
check("no songbooks", r.status === 400, JSON.stringify(r.body));
const date = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
const event = (await call(alice, "POST", `/teams/${welcome.id}/events`, { title: "Sunday welcome", date, startTime: "09:30", timeZone: "UTC" })).body;
r = await call(alice, "POST", `/teams/${welcome.id}/events/${event.id}/dates/${date}/set`);
check("its dates: on its calendar, without a set", r.status === 400 && (await call(alice, "GET", `/teams/${welcome.id}/event-dates?from=${date}&to=${date}`)).body[0]?.setlistId === null, JSON.stringify(r.body));

// --- moving groups around
r = await call(alice, "PATCH", `/teams/${music.id}/group`, { parentId: choir.id });
check("under one of its own subgroups: refused", r.status === 400, JSON.stringify(r.body));
r = await call(alice, "PATCH", `/teams/${music.id}/group`, { parentId: music.id });
check("under itself: refused", r.status === 400, String(r.status));
r = await call(alice, "PATCH", `/teams/${choir.id}/group`, { parentId: null });
check("back at the top", r.status === 200 && r.body.parentId === null, JSON.stringify(r.body));
await call(alice, "POST", "/setlists", { name: "Sunday", teamId: music.id });
r = await call(alice, "PATCH", `/teams/${music.id}/group`, { usesSongverse: false });
check("a team with sets can't stop using Songverse", r.status === 409, JSON.stringify(r.body));
r = await call(alice, "PATCH", `/teams/${welcome.id}/group`, { usesSongverse: true });
check("a group can start using Songverse", r.status === 200 && r.body.usesSongverse === true, JSON.stringify(r.body));
await call(alice, "PATCH", `/teams/${welcome.id}/group`, { usesSongverse: false });

// --- positions
const welcomeLink = (await call(alice, "POST", `/teams/${welcome.id}/invite-links`, {})).body;
await call(bob, "POST", `/teams/join/${welcomeLink.token}`);
r = await call(bob, "POST", `/teams/${welcome.id}/positions`, { name: "Greeter" });
check("only its admins make positions", r.status === 403, String(r.status));
const greeter = (await call(alice, "POST", `/teams/${welcome.id}/positions`, { name: "Greeter" })).body;
const coffee = (await call(alice, "POST", `/teams/${welcome.id}/positions`, { name: "Coffee" })).body;
r = await call(alice, "POST", `/teams/${welcome.id}/positions`, { name: "Greeter" });
check("a name once per group", r.status === 409, String(r.status));
r = await call(bob, "GET", `/teams/${welcome.id}/positions`);
check("its members see them, in order", r.status === 200 && r.body.map((p) => p.name).join() === "Greeter,Coffee", JSON.stringify(r.body));
r = await call(bob, "PUT", `/teams/${welcome.id}/members/${bob.id}/positions`, { positionIds: [greeter.id] });
check("a member says which they cover", r.status === 200 && r.body.positionIds.join() === greeter.id, JSON.stringify(r.body));
r = await call(bob, "PUT", `/teams/${welcome.id}/members/${alice.id}/positions`, { positionIds: [coffee.id] });
check("…not someone else's", r.status === 403, String(r.status));
r = await call(alice, "PUT", `/teams/${welcome.id}/members/${bob.id}/positions`, { positionIds: [greeter.id, coffee.id] });
check("its admins set anyone's", r.status === 200 && r.body.positionIds.length === 2, JSON.stringify(r.body));
const musicPosition = (await call(alice, "POST", `/teams/${music.id}/positions`, { name: "Sound desk" })).body;
r = await call(alice, "PUT", `/teams/${welcome.id}/members/${bob.id}/positions`, { positionIds: [musicPosition.id] });
check("another group's position: refused", r.status === 400, JSON.stringify(r.body));
r = await call(alice, "PATCH", `/teams/${welcome.id}/positions/${coffee.id}`, { name: "Tea and coffee" });
check("renamed", r.status === 200 && r.body.name === "Tea and coffee", JSON.stringify(r.body));
r = await call(alice, "DELETE", `/teams/${welcome.id}/positions/${greeter.id}`);
const members = (await call(alice, "GET", `/teams/${welcome.id}/members`)).body;
check("deleted: gone from who covered it", r.status === 204 && members.find((m) => m.userId === bob.id)?.positionIds.join() === coffee.id, JSON.stringify(members.map((m) => m.positionIds)));

// --- a position as a part an event needs
r = await call(alice, "PATCH", `/teams/${welcome.id}/events/${event.id}`, { parts: [{ position: musicPosition.id, count: 1 }] });
check("another group's position as a part: refused", r.status === 400, JSON.stringify(r.body));
r = await call(alice, "PATCH", `/teams/${welcome.id}/events/${event.id}`, { parts: [{ position: coffee.id, count: 2 }, { name: "Door", count: 1 }] });
check("the group's position as a part: kept with its name", r.status === 200 && r.body.parts[0].position === coffee.id && r.body.parts[0].name === "Tea and coffee", JSON.stringify(r.body.parts));
await call(bob, "PUT", `/teams/${welcome.id}/events/${event.id}/dates/${date}/answer`, { answer: "AVAILABLE" });
await call(alice, "PUT", `/teams/${welcome.id}/events/${event.id}/dates/${date}/answer`, { answer: "AVAILABLE" });
let coverage = (await call(alice, "GET", `/teams/${welcome.id}/event-dates?from=${date}&to=${date}`)).body[0].coverage;
let covered = coverage.find((part) => part.key === `position:${coffee.id}`);
check("covered by who ticked it, not everyone available", covered?.available === 1 && covered.missing === 1 && covered.name === "Tea and coffee", JSON.stringify(coverage));
await call(alice, "PATCH", `/teams/${welcome.id}/positions/${coffee.id}`, { name: "Coffee" });
covered = (await call(alice, "GET", `/teams/${welcome.id}/event-dates?from=${date}&to=${date}`)).body[0].coverage.find((part) => part.key === `position:${coffee.id}`);
check("renamed: the event's part too", covered?.name === "Coffee", JSON.stringify(covered));
r = await call(alice, "DELETE", `/teams/${welcome.id}/positions/${coffee.id}`);
check("a position an event asks for isn't deleted", r.status === 409 && String(r.body.message).includes("Sunday welcome"), JSON.stringify(r.body));
r = await call(alice, "POST", `/teams/${welcome.id}/events/${event.id}/dates/${date}/lineup`, { userId: bob.id, part: `position:${coffee.id}` });
check("scheduled on it: told, by its name", r.status === 201 && (await call(bob, "GET", "/users/me/notifications?limit=20")).body.items.some((n) => n.kind === "SCHEDULED" && n.data.partName === "Coffee"), JSON.stringify(r.body));

// --- a group's admins make sub-groups under it (issue #245)
r = await call(bob, "POST", `/organizations/${org.id}/groups`, { name: `Parking ${stamp}`, parentId: welcome.id });
check("a group's member: no sub-group", r.status === 403, String(r.status));
await call(alice, "PATCH", `/teams/${welcome.id}/members/${bob.id}`, { role: "ADMIN" });
r = await call(bob, "POST", `/organizations/${org.id}/groups`, { name: `Parking ${stamp}`, parentId: welcome.id });
check("its admin: a sub-group under it, run by them", r.status === 201 && r.body.parentId === welcome.id && r.body.currentUserRole === "ADMIN" && r.body.organization?.id === org.id, JSON.stringify(r.body));
r = await call(bob, "POST", `/organizations/${org.id}/groups`, { name: "Top" });
check("…not at the top", r.status === 403, String(r.status));
r = await call(bob, "POST", `/organizations/${org.id}/groups`, { name: "Choir 2", parentId: music.id });
check("…nor under a group they don't run", r.status === 403, String(r.status));

// --- out of the organisation
await call(alice, "PATCH", `/teams/${choir.id}/group`, { parentId: music.id });
r = await call(alice, "DELETE", `/organizations/${org.id}/teams/${music.id}`);
check("a team taken out: its subgroups no longer under it", r.status === 204 && (await call(alice, "GET", `/teams/${choir.id}`)).body.parentId === null, String(r.status));
r = await call(alice, "PUT", `/teams/${welcome.id}/organization`, { organizationId: null });
check("a group that only planned, out of it: a Songverse team again", r.status === 200 && r.body.organization === null && r.body.usesSongverse === true, JSON.stringify(r.body));

await call(admin, "DELETE", "/admin/organizations/settings");
finish();
