// An organisation's event types (issue #528): its admins keep the kinds of
// events all its groups hold - parts required, places open to "the group the
// event is in" or to named groups, with a set or not. Every group sees them
// beside its own and makes events from them; only the organisation's admins
// change them, and a group's admins still keep types of their own.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Org types admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const planner = await user("Org types planner");
const leader = await user("Org types group admin");
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
try {
  const org = (await call(planner, "POST", "/organizations", { name: `Org types church ${stamp}` })).body;
  const music = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Music ${stamp}`, usesSongverse: true })).body;
  const youth = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Youth ${stamp}` })).body;
  sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('omot${stamp}', '${org.id}', '${leader.id}', 'MEMBER', now(), now())`);
  sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmot${stamp}', '${music.id}', '${leader.id}', 'ADMIN', now(), now())`);
  const other = (await call(admin, "POST", "/teams", { name: `Elsewhere ${stamp}` })).body;

  const base = `/organizations/${org.id}/event-types`;
  const service = { name: "Service", startTime: "10:00", durationMinutes: 120, withSet: true, parts: [{ part: "HOST", count: 1, required: true }, { part: "MUSIC_LEADER", count: 1, required: true, openTo: ["own", youth.id] }] };
  let r = await call(leader, "POST", base, service);
  check("a group's admin doesn't make the organisation's types", r.status === 403, String(r.status));
  r = await call(planner, "POST", base, { ...service, parts: [{ part: "MUSIC_LEADER", count: 1, openTo: [other.id] }] });
  check("open only to its own groups", r.status === 400, JSON.stringify(r.body));
  r = await call(planner, "POST", base, { ...service, parts: [{ position: "x", count: 1 }] });
  check("no group's positions", r.status === 400, JSON.stringify(r.body));
  r = await call(planner, "POST", base, service);
  check("its admins make one: required parts, a place open to the group the event is in and to Youth", r.status === 201 && r.body.organizationId === org.id && r.body.teamId === null && r.body.parts[1].openTo.join() === `own,${youth.id}`, JSON.stringify(r.body));
  const type = r.body;
  r = await call(planner, "POST", base, { name: "Meeting", withSet: false });
  check("…and one without a set", r.status === 201 && r.body.withSet === false, JSON.stringify(r.body));
  r = await call(planner, "POST", base, { name: "Service" });
  check("one of each name", r.status === 409, String(r.status));
  check("its members see them", (await call(leader, "GET", base)).body.map((one) => one.name).join() === "Meeting,Service");

  // A group: the organisation's types beside its own.
  r = await call(leader, "POST", `/teams/${music.id}/event-types`, { name: "Rehearsal", withSet: true, parts: [{ part: "DRUMS", count: 1 }] });
  check("the group still keeps its own", r.status === 201, JSON.stringify(r.body));
  const types = (await call(leader, "GET", `/teams/${music.id}/event-types`)).body;
  check("the group's list: the organisation's first, named, then its own", types.map((one) => one.name).join() === "Meeting,Service,Rehearsal" && types[0].organizationName === org.name, JSON.stringify(types));
  r = await call(leader, "PATCH", `/teams/${music.id}/event-types/${type.id}`, { name: "Mine now" });
  check("…not changed by the group", r.status === 404, String(r.status));
  r = await call(leader, "DELETE", `/teams/${music.id}/event-types/${type.id}`);
  check("…nor deleted", r.status === 404, String(r.status));

  // An event made from it, in the group: "own" is the group, and it asks for more.
  r = await call(leader, "POST", `/teams/${music.id}/events`, {
    title: "Sunday",
    date: plus(3),
    startTime: "10:00",
    timeZone: "UTC",
    typeId: type.id,
    parts: [{ part: "HOST", count: 1, required: true }, { part: "MUSIC_LEADER", count: 1, required: true, openTo: [music.id, youth.id] }, { part: "DRUMS", count: 1 }],
  });
  check("an event from it, with an extra part", r.status === 201 && r.body.typeId === type.id && r.body.parts.length === 3, JSON.stringify(r.body));
  r = await call(leader, "POST", `/teams/${music.id}/events`, { title: "Sunday", date: plus(3), startTime: "10:00", timeZone: "UTC", parts: [{ part: "MUSIC_LEADER", count: 1, openTo: ["own"] }] });
  check("an event's own places name the group itself", r.status === 400, JSON.stringify(r.body));
  r = await call(admin, "POST", `/teams/${other.id}/events`, { title: "Elsewhere", date: plus(3), startTime: "10:00", timeZone: "UTC", typeId: type.id });
  check("another organisation's type: not for a team outside it", r.status === 400, JSON.stringify(r.body));

  r = await call(planner, "PATCH", `${base}/${type.id}`, { name: "Sunday service" });
  check("its admins change it", r.status === 200 && r.body.name === "Sunday service" && r.body.eventCount === 1, JSON.stringify(r.body));
  r = await call(planner, "DELETE", `${base}/${type.id}`);
  check("…and delete it: its events stay", r.status === 204 && (await call(leader, "GET", `/teams/${music.id}/events`)).body.some((one) => one.title === "Sunday" && one.typeId === null));

  await call(admin, "DELETE", `/admin/organizations/${org.id}`);
} finally {
  await call(admin, "DELETE", "/admin/organizations/settings");
}
await finish();
