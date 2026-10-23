// Locations (issue #320): where an organisation's or a team's events take place, with their time zone. Their
// owner's admins make and change them; members see them, nobody else. A team's event takes one of the team's or
// its organisation's locations, an organisation's event one of the organisation's - its groups' parts follow it;
// the place is filled from the location when left out, and stays when the location goes.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("Locations global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
const lead = await user("Locations lead");
const member = await user("Locations member");
const stranger = await user("Locations stranger");
const org = (await call(lead, "POST", "/organizations", { name: `Location church ${stamp}` })).body;
const team = (await call(lead, "POST", "/teams", { name: `Location team ${stamp}` })).body;
await call(lead, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });
await call(member, "POST", `/teams/join/${(await call(lead, "POST", `/teams/${team.id}/invite-links`, { role: "MEMBER" })).body.token}`);
const strangersTeam = (await call(stranger, "POST", "/teams", { name: `Elsewhere ${stamp}` })).body;

// --- making them
let r = await call(member, "POST", "/locations", { name: "Not mine", timeZone: "Europe/Paris", teamId: team.id });
check("only the team's admins add its locations", r.status === 403, String(r.status));
r = await call(lead, "POST", "/locations", { name: "Both", timeZone: "Europe/Paris", teamId: team.id, organizationId: org.id });
check("a location belongs to a team or an organisation, not both", r.status === 400, JSON.stringify(r.body));
r = await call(lead, "POST", "/locations", { name: "Somewhere", timeZone: "Mars/Olympus", organizationId: org.id });
check("a time zone that isn't one is refused", r.status === 400 && r.body.message.some((m) => m.includes("timeZone")), JSON.stringify(r.body));
r = await call(lead, "POST", "/locations", { name: "Main campus", address: "1 Church Street, Lyon", timeZone: "Europe/Paris", organizationId: org.id });
const campus = r.body;
check("an organisation's location, by its admin", r.status === 201 && campus.owner.kind === "organization" && campus.address === "1 Church Street, Lyon" && campus.canEdit, JSON.stringify(r.body));
const hall = (await call(lead, "POST", "/locations", { name: "Youth hall", timeZone: "Europe/Paris", teamId: team.id })).body;
check("a team's location", hall.owner?.kind === "team" && hall.owner.id === team.id, JSON.stringify(hall));
r = await call(stranger, "POST", "/locations", { name: "Nope", timeZone: "UTC", organizationId: org.id });
check("…not by someone outside it", r.status === 403, String(r.status));
const theirs = (await call(stranger, "POST", "/locations", { name: "Their hall", timeZone: "UTC", teamId: strangersTeam.id })).body;

// --- who sees them
r = await call(member, "GET", `/locations?teamId=${team.id}`);
check("a team's members see what its events can take: its own and its organisation's", r.status === 200 && r.body.map((one) => one.name).join() === "Main campus,Youth hall" && r.body.every((one) => !one.canEdit), JSON.stringify(r.body));
r = await call(member, "GET", "/locations");
check("…and every location they can use", r.status === 200 && r.body.length === 2, JSON.stringify(r.body));
r = await call(stranger, "GET", `/locations?organizationId=${org.id}`);
check("someone outside it doesn't", r.status === 404, String(r.status));
r = await call(stranger, "GET", `/locations/${campus.id}`);
check("…nor one of its locations", r.status === 404, String(r.status));

// --- changing them
r = await call(member, "PATCH", `/locations/${hall.id}`, { name: "Mine now" });
check("a member doesn't change them", r.status === 403, String(r.status));
r = await call(lead, "PATCH", `/locations/${hall.id}`, { name: "Youth room", address: "Back door" });
check("its admin does", r.status === 200 && r.body.name === "Youth room" && r.body.address === "Back door", JSON.stringify(r.body));
r = await call(lead, "PATCH", `/locations/${hall.id}`, { address: null });
check("an address cleared", r.status === 200 && r.body.address === null && r.body.name === "Youth room", JSON.stringify(r.body));

// --- a team's events
r = await call(lead, "POST", `/teams/${team.id}/events`, { title: "Rehearsal", date: plus(3), startTime: "19:00", timeZone: "Europe/Paris", locationId: theirs.id });
check("a team's event can't take someone else's location", r.status === 400 && r.body.message.some((m) => m.includes("locationId")), JSON.stringify(r.body));
r = await call(lead, "POST", `/teams/${team.id}/events`, { title: "Rehearsal", date: plus(3), startTime: "19:00", timeZone: "Europe/Paris", locationId: hall.id });
const rehearsal = r.body;
check("…takes the team's, its place filled from it", r.status === 201 && rehearsal.locationId === hall.id && rehearsal.place === "Youth room", JSON.stringify(r.body));
r = await call(lead, "PATCH", `/teams/${team.id}/events/${rehearsal.id}`, { locationId: campus.id });
check("…or its organisation's: another location, its place follows", r.status === 200 && r.body.locationId === campus.id && r.body.place === "Main campus", JSON.stringify(r.body));
r = await call(lead, "PATCH", `/teams/${team.id}/events/${rehearsal.id}`, { place: "Room 4" });
check("a place of its own beside the location", r.status === 200 && r.body.locationId === campus.id && r.body.place === "Room 4", JSON.stringify(r.body));
r = await call(member, "GET", `/teams/${team.id}/event-dates?from=${plus(3)}&to=${plus(3)}`);
check("its dates say where", r.status === 200 && r.body[0]?.locationId === campus.id && r.body[0]?.place === "Room 4", JSON.stringify(r.body));
r = await call(lead, "PATCH", `/teams/${team.id}/events/${rehearsal.id}`, { locationId: null });
check("…and the location taken off", r.status === 200 && r.body.locationId === null && r.body.place === "Room 4", JSON.stringify(r.body));

// --- an organisation's events
const base = `/organizations/${org.id}`;
const service = { title: "Sunday service", date: plus(6), startTime: "10:00", timeZone: "Europe/Paris", hostUserId: lead.id, needs: [{ teamId: team.id }] };
r = await call(lead, "POST", `${base}/events`, { ...service, locationId: hall.id });
check("an organisation's event can't take a team's location", r.status === 400 && r.body.message.some((m) => m.includes("organisation's locations")), JSON.stringify(r.body));
r = await call(lead, "POST", `${base}/events`, { ...service, locationId: campus.id });
const sunday = r.body;
check("…takes the organisation's", r.status === 201 && sunday.locationId === campus.id && sunday.place === "Main campus", JSON.stringify(r.body));
r = await call(member, "GET", `/teams/${team.id}/events/${sunday.needs[0].teamEventId}`);
check("its group's part is there too", r.status === 200 && r.body.locationId === campus.id && r.body.place === "Main campus", JSON.stringify(r.body));
const annex = (await call(lead, "POST", "/locations", { name: "Annex", timeZone: "Europe/Paris", organizationId: org.id })).body;
r = await call(lead, "PATCH", `${base}/events/${sunday.id}`, { locationId: annex.id });
check("moved to another location", r.status === 200 && r.body.locationId === annex.id && r.body.place === "Annex", JSON.stringify(r.body));
r = await call(member, "GET", `/teams/${team.id}/events/${sunday.needs[0].teamEventId}`);
check("…its group's part follows", r.body.locationId === annex.id && r.body.place === "Annex", JSON.stringify(r.body));
r = await call(lead, "GET", `${base}/event-dates?from=${plus(6)}&to=${plus(6)}`);
check("its dates say where", r.status === 200 && r.body[0]?.locationId === annex.id, JSON.stringify(r.body));
r = await call(lead, "POST", `${base}/event-presets`, { name: `Usual ${stamp}`, title: "Sunday service", startTime: "10:00", locationId: campus.id, needs: [{ teamId: team.id }] });
check("a preset keeps its location", r.status === 201 && r.body.locationId === campus.id && r.body.place === "Main campus", JSON.stringify(r.body));

// --- removing one
r = await call(member, "DELETE", `/locations/${annex.id}`);
check("a member doesn't remove one", r.status === 403, String(r.status));
r = await call(lead, "DELETE", `/locations/${annex.id}`);
check("its admin does", r.status === 204, String(r.status));
r = await call(member, "GET", `/teams/${team.id}/events/${sunday.needs[0].teamEventId}`);
check("its events keep their place, without the location", r.body.locationId === null && r.body.place === "Annex", JSON.stringify(r.body));

finish();
