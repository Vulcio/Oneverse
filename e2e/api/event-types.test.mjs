// A team's event types (issue #523): "Service" asks for a Host and a
// Music leader and gets a set, "Meeting" gets none. Members see them, its
// admins keep them; an event made from one remembers it, and keeps its own
// copy when the type changes or goes. An event without a set makes none, and
// turning sets off deletes its coming empty ones (sets with songs stay).
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("event types admin");
const member = await user("event types member");
const stranger = await user("event types stranger");
const team = (await call(admin, "POST", "/teams", { name: `Event types ${stamp}` })).body;
const other = (await call(stranger, "POST", "/teams", { name: `Event types other ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmet${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const types = `/teams/${team.id}/event-types`;

// --- the types
let r = await call(admin, "POST", types, {
  name: "Service",
  startTime: "10:00",
  durationMinutes: 120,
  parts: [
    { part: "HOST", count: 1 },
    { part: "SPEAKER", count: 1 },
    { part: "MUSIC_LEADER", count: 1 },
  ],
});
check("a type: a host, a speaker, a music leader, with a set", r.status === 201 && r.body.withSet === true && r.body.parts.map((part) => part.part).join() === "HOST,SPEAKER,MUSIC_LEADER" && r.body.eventCount === 0, JSON.stringify(r.body));
const service = r.body;
r = await call(admin, "POST", types, { name: "Meeting", startTime: "19:00", durationMinutes: 60, withSet: false });
check("a type without a set", r.status === 201 && r.body.withSet === false && r.body.parts.length === 0, JSON.stringify(r.body));
const meeting = r.body;
r = await call(admin, "POST", types, { name: "Service" });
check("one type of each name", r.status === 409, JSON.stringify(r.body));
r = await call(admin, "POST", types, { name: "Odd", parts: [{ part: "JUGGLER", count: 1 }] });
check("a part that isn't an instrument or a role: refused", r.status === 400 && r.body.message.join().includes("JUGGLER"), JSON.stringify(r.body));
r = await call(member, "POST", types, { name: "Mine" });
check("a member can't make one", r.status === 403, JSON.stringify(r.body));
r = await call(member, "GET", types);
check("members see them, by name", r.status === 200 && r.body.map((type) => type.name).join() === "Meeting,Service", JSON.stringify(r.body));
r = await call(stranger, "GET", types);
check("others don't", r.status === 403, JSON.stringify(r.body));

// --- events of a type
const sunday = plus(3);
r = await call(admin, "POST", `/teams/${team.id}/events`, { title: "Service", date: sunday, startTime: "10:00", timeZone: "UTC", parts: service.parts, typeId: service.id });
check("an event made from a type remembers it", r.status === 201 && r.body.typeId === service.id && r.body.withSet === true, JSON.stringify(r.body));
const serviceEvent = r.body;
const otherType = (await call(stranger, "POST", `/teams/${other.id}/event-types`, { name: "Theirs" })).body;
r = await call(admin, "POST", `/teams/${team.id}/events`, { title: "x", date: sunday, startTime: "10:00", timeZone: "UTC", typeId: otherType.id });
check("another team's type: refused", r.status === 400, JSON.stringify(r.body));

const wednesday = plus(6);
r = await call(admin, "POST", `/teams/${team.id}/events`, { title: "Team meeting", date: wednesday, startTime: "19:00", timeZone: "UTC", typeId: meeting.id, withSet: false });
check("an event without sets", r.status === 201 && r.body.withSet === false, JSON.stringify(r.body));
const meetingEvent = r.body;
let dates = (await call(admin, "GET", `/teams/${team.id}/event-dates?from=${sunday}&to=${wednesday}`)).body;
const serviceDate = dates.find((one) => one.eventId === serviceEvent.id);
const meetingDate = dates.find((one) => one.eventId === meetingEvent.id);
check("the service's date has its set", !!serviceDate.setlistId && serviceDate.withSet === true, JSON.stringify(serviceDate));
check("the meeting's date has none", meetingDate.setlistId === null && meetingDate.withSet === false, JSON.stringify(meetingDate));
r = await call(admin, "POST", `/teams/${team.id}/events/${meetingEvent.id}/dates/${wednesday}/set`);
check("…and none can be made for it", r.status === 400 && r.body.message.join().includes("no set"), JSON.stringify(r.body));

// --- the type changes or goes: its events keep theirs
r = await call(admin, "PATCH", `${types}/${service.id}`, { parts: [{ part: "HOST", count: 1 }] });
check("a type changed", r.status === 200 && r.body.parts.length === 1 && r.body.eventCount === 1, JSON.stringify(r.body));
r = await call(admin, "GET", `/teams/${team.id}/events/${serviceEvent.id}`);
check("…its event keeps its parts", r.body.parts.length === 3, JSON.stringify(r.body));
r = await call(admin, "DELETE", `${types}/${service.id}`);
check("a type deleted", r.status === 204, JSON.stringify(r.body));
r = await call(admin, "GET", `/teams/${team.id}/events/${serviceEvent.id}`);
check("…its event stays, with no type", r.status === 200 && r.body.typeId === null && r.body.parts.length === 3, JSON.stringify(r.body));

// --- sets turned off and on again
const repeating = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Weekly", date: plus(1), startTime: "10:00", timeZone: "UTC", repeat: { everyWeeks: 1 } })).body;
dates = (await call(admin, "GET", `/teams/${team.id}/event-dates?from=${plus(1)}&to=${plus(8)}`)).body.filter((one) => one.eventId === repeating.id);
check("a weekly event: two sets in the coming week and a bit", dates.length === 2 && dates.every((one) => one.setlistId), JSON.stringify(dates));
const [first, second] = dates;
sql(`insert into "SetlistItem" (id, "setlistId", kind, text, position, "updatedAt") values ('etitem${stamp}', '${first.setlistId}', 'TEXT', '{"title":"Welcome","body":""}', 0, now())`);
r = await call(admin, "PATCH", `/teams/${team.id}/events/${repeating.id}`, { withSet: false });
check("sets turned off", r.status === 200 && r.body.withSet === false, JSON.stringify(r.body));
dates = (await call(admin, "GET", `/teams/${team.id}/event-dates?from=${plus(1)}&to=${plus(8)}`)).body.filter((one) => one.eventId === repeating.id);
check("…the set with something in it stays, the empty one goes", dates[0].setlistId === first.setlistId && dates[1].setlistId === null, JSON.stringify(dates));
check("…deleted, not just let go", sql(`select count(*) from "Setlist" where id='${second.setlistId}'`) === "0");
r = await call(admin, "PATCH", `/teams/${team.id}/events/${repeating.id}`, { withSet: true });
dates = (await call(admin, "GET", `/teams/${team.id}/event-dates?from=${plus(1)}&to=${plus(8)}`)).body.filter((one) => one.eventId === repeating.id);
check("sets turned on again: made again", dates.every((one) => one.setlistId) && dates[1].setlistId !== second.setlistId, JSON.stringify(dates));

finish();
