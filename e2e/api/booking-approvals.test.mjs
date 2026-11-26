// Bookings, part 2 (issue #565): a venue's and a resource's calendar of bookings, for whoever sees them; asking the
// event holding a room to free it (its organisers are told); and rooms and resources whose bookings wait for a
// manager's approval - a Facilities team's admins, else the owner's - the request holding the slot meanwhile.
// Approved: the event keeps it. Declined: the event gives it up.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("Approvals global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const lead = await user("Approvals lead");
const keeper = await user("Approvals facilities");
const youthLead = await user("Approvals youth lead");
const stranger = await user("Approvals stranger");
const org = (await call(lead, "POST", "/organizations", { name: `Approval church ${stamp}` })).body;
const worship = (await call(lead, "POST", "/teams", { name: `Worship ${stamp}` })).body;
const facilities = (await call(lead, "POST", "/teams", { name: `Facilities ${stamp}` })).body;
const youth = (await call(lead, "POST", "/teams", { name: `Youth ${stamp}` })).body;
for (const [who, team] of [[lead, worship], [keeper, facilities], [youthLead, youth]]) {
  await call(lead, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });
  if (who === lead) continue;
  // Its admin is someone else: the lead only a member.
  await call(who, "POST", `/teams/join/${(await call(lead, "POST", `/teams/${team.id}/invite-links`, { role: "ADMIN" })).body.token}`);
  sql(`update "TeamMembership" set role='MEMBER' where "teamId"='${team.id}' and "userId"='${lead.id}'`);
}
const elsewhere = (await call(stranger, "POST", "/teams", { name: `Elsewhere ${stamp}` })).body;
const campus = (await call(lead, "POST", "/locations", { name: "Campus", timeZone: "Europe/Paris", organizationId: org.id })).body;
let r = await call(lead, "POST", `/locations/${campus.id}/rooms`, { name: "Main hall", needsApproval: true, managerTeamId: facilities.id });
const hall = r.body.rooms?.find((room) => room.name === "Main hall");
check("a room whose bookings the Facilities team approves", r.status === 201 && hall.needsApproval && hall.managerTeam?.name === `Facilities ${stamp}`, JSON.stringify(r.body));
r = await call(lead, "POST", `/locations/${campus.id}/rooms`, { name: "Elsewhere managed", managerTeamId: elsewhere.id });
check("…only a team of the organisation manages it", r.status === 400, JSON.stringify(r.body));
const kids = (await call(lead, "POST", `/locations/${campus.id}/rooms`, { name: "Kids room" })).body.rooms.find((room) => room.name === "Kids room");
r = await call(lead, "POST", "/resources", { name: "Van", organizationId: org.id, needsApproval: true });
const van = r.body;
check("a resource its owner's admins approve", r.status === 201 && van.needsApproval && van.managerTeam === null, JSON.stringify(r.body));

// --- a request holds the slot until approved
const day = plus(10);
const base = { timeZone: "Europe/Paris", locationId: campus.id, durationMinutes: 120, date: day };
r = await call(youthLead, "POST", `/teams/${youth.id}/events`, { ...base, title: "Youth night", startTime: "19:00", roomIds: [hall.id] });
const night = r.body;
check("booking the hall asks for approval", r.status === 201 && night.awaitingApproval?.join() === "Main hall", JSON.stringify(r.body));
r = await call(lead, "POST", `/teams/${worship.id}/events`, { ...base, title: "Prayer", startTime: "20:00", roomIds: [hall.id] });
check("…and holds the slot meanwhile", r.status === 409 && r.body.message[0].includes("Youth night"), JSON.stringify(r.body));
r = await call(keeper, "GET", "/users/me/notifications?limit=100");
const asked = (r.body.items ?? r.body).find((one) => one.kind === "BOOKING_REQUESTED");
check("the Facilities team's admin is told", !!asked && asked.data.what === "Main hall" && asked.data.event === "Youth night", JSON.stringify(r.body).slice(0, 600));
r = await call(keeper, "GET", "/bookings/requests");
const request = r.body.find((one) => one.eventId === night.id);
check("…and sees it waiting", r.status === 200 && request?.what === "Main hall" && request.owner === `Youth ${stamp}` && request.requestedBy === "Approvals youth lead", JSON.stringify(r.body));
r = await call(lead, "GET", "/bookings/requests");
check("the organisation's admin doesn't decide the Facilities team's room", r.status === 200 && !r.body.some((one) => one.eventId === night.id), JSON.stringify(r.body));
r = await call(lead, "POST", `/bookings/requests/${request.id}/approve`);
check("…and can't approve it", r.status === 403, String(r.status));
r = await call(keeper, "POST", `/bookings/requests/${request.id}/approve`);
check("approved by Facilities", r.status === 204, String(r.status));
r = await call(youthLead, "GET", `/teams/${youth.id}/events/${night.id}`);
check("the event no longer waits", r.body.awaitingApproval?.length === 0 && r.body.rooms[0].id === hall.id, JSON.stringify(r.body));
r = await call(youthLead, "GET", "/users/me/notifications?limit=100");
check("whoever asked is told", (r.body.items ?? r.body).some((one) => one.kind === "BOOKING_APPROVED" && one.data.what === "Main hall"), JSON.stringify(r.body).slice(0, 600));

// --- a manager's own booking needs no approval; a declined one is given up
r = await call(keeper, "POST", `/teams/${facilities.id}/events`, { ...base, date: plus(11), title: "Deep clean", startTime: "08:00", roomIds: [hall.id] });
check("a manager's own booking is approved at once", r.status === 201 && r.body.awaitingApproval?.length === 0, JSON.stringify(r.body));
r = await call(youthLead, "POST", `/teams/${youth.id}/events`, { ...base, date: plus(12), title: "Road trip", startTime: "09:00", resources: [{ resourceId: van.id }] });
const trip = r.body;
check("the van asks the organisation's admins", r.status === 201 && trip.awaitingApproval?.join() === "Van", JSON.stringify(r.body));
r = await call(lead, "GET", `/bookings/requests?organizationId=${org.id}`);
const vanRequest = r.body.find((one) => one.eventId === trip.id);
check("…who see it", !!vanRequest && vanRequest.kind === "resource", JSON.stringify(r.body));
r = await call(lead, "POST", `/bookings/requests/${vanRequest.id}/decline`);
check("declined", r.status === 204, String(r.status));
r = await call(youthLead, "GET", `/teams/${youth.id}/events/${trip.id}`);
check("…the event gives the van up", r.body.resources.length === 0 && r.body.awaitingApproval.length === 0, JSON.stringify(r.body));
r = await call(youthLead, "GET", "/users/me/notifications?limit=100");
check("…and whoever asked is told", (r.body.items ?? r.body).some((one) => one.kind === "BOOKING_DECLINED" && one.data.what === "Van"), JSON.stringify(r.body).slice(0, 600));

// --- calendars
r = await call(youthLead, "GET", `/locations/${campus.id}/bookings?from=${plus(9)}&to=${plus(13)}`);
const booked = r.body ?? [];
check("the venue's calendar: its rooms' bookings, set-up included", r.status === 200 && booked.map((one) => one.event).join() === "Youth night,Deep clean" && booked[0].what === "Main hall" && booked[0].owner === `Youth ${stamp}`, JSON.stringify(r.body));
r = await call(stranger, "GET", `/locations/${campus.id}/bookings?from=${plus(9)}&to=${plus(13)}`);
check("…not for someone outside", r.status === 404, String(r.status));
r = await call(youthLead, "GET", `/locations/${campus.id}/bookings?from=${plus(13)}&to=${plus(9)}`);
check("…a range the right way round", r.status === 400, JSON.stringify(r.body));
await call(youthLead, "POST", `/teams/${youth.id}/events`, { ...base, date: plus(14), title: "Car wash", startTime: "10:00", roomIds: [kids.id], resources: [{ resourceId: van.id }] });
r = await call(lead, "GET", `/resources/${van.id}/bookings?from=${plus(9)}&to=${plus(20)}`);
check("the resource's calendar", r.status === 200 && r.body.length === 1 && r.body[0].event === "Car wash" && r.body[0].quantity === 1, JSON.stringify(r.body));

// --- asking the holder
r = await call(lead, "POST", "/bookings/ask", { eventId: night.id, eventKind: "team", date: day, kind: "room", id: hall.id, message: "Could you use the kids room?" });
check("asking the event holding the hall tells its organisers", r.status === 201 && r.body.told >= 1, JSON.stringify(r.body));
r = await call(youthLead, "GET", "/users/me/notifications?limit=100");
const ask = (r.body.items ?? r.body).find((one) => one.kind === "BOOKING_ASKED");
check("…with who asks, for what, when and why", ask?.data.by === "Approvals lead" && ask.data.what === "Main hall" && ask.data.date === day && ask.data.note === "Could you use the kids room?", JSON.stringify(ask));
r = await call(lead, "POST", "/bookings/ask", { eventId: night.id, eventKind: "team", date: day, kind: "room", id: kids.id });
check("…only of an event taking it", r.status === 404, JSON.stringify(r.body));
r = await call(stranger, "POST", "/bookings/ask", { eventId: night.id, eventKind: "team", date: day, kind: "room", id: hall.id });
check("…by someone who sees the room", r.status === 404, JSON.stringify(r.body));

finish();
