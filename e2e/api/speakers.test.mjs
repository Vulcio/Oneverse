// Who may speak at a team's dates (issue #523): like hosting (issue #520), a
// role's right - "Speak at the dates" - given by the organisation to one of
// its groups (every member of it can be a date's Speaker) or to one person as
// a one-off. Unlike hosting, guests can speak too: one of the admin's People,
// or someone without an account, by name. A member without the role can't.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Speakers admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const planner = await user("Speakers planner");
const preacher = await user("Speakers preacher");
const visitor = await user("Speakers visitor");
const musician = await user("Speakers musician");
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
try {
  const org = (await call(planner, "POST", "/organizations", { name: `Speakers church ${stamp}` })).body;
  const music = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Music ${stamp}`, usesSongverse: true })).body;
  const preaching = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Preaching ${stamp}` })).body;
  const join = (who, teamId, n) => {
    sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('oms${n}${stamp}', '${org.id}', '${who.id}', 'MEMBER', now(), now()) on conflict do nothing`);
    if (teamId) sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tms${n}${stamp}', '${teamId}', '${who.id}', 'MEMBER', now(), now())`);
  };
  join(preacher, preaching.id, 1);
  join(musician, music.id, 2);
  join(visitor, null, 3);

  // The suggested Service type asks for one (issue #523).
  const event = (await call(planner, "POST", `/teams/${music.id}/events`, { title: "Sunday", date: plus(3), startTime: "10:00", timeZone: "UTC", parts: [{ part: "SPEAKER", count: 3 }, { part: "DRUMS", count: 1 }] })).body;
  check("an event asks for a Speaker", event.parts?.[0]?.part === "SPEAKER", JSON.stringify(event));
  const base = `/teams/${music.id}/events/${event.id}/dates/${plus(3)}`;
  let r = await call(planner, "POST", `${base}/lineup`, { userId: preacher.id, part: "SPEAKER" });
  check("without the role: nobody with an account speaks", r.status === 400, JSON.stringify(r.body));
  r = await call(planner, "POST", `${base}/lineup`, { userId: musician.id, part: "SPEAKER" });
  check("…not even a member of the team", r.status === 400, JSON.stringify(r.body));

  const speakers = (await call(planner, "POST", `/organizations/${org.id}/roles`, { name: "Speakers", canSpeak: true })).body;
  check("the organisation's own role that speaks", speakers.canSpeak === true, JSON.stringify(speakers));
  r = await call(planner, "PUT", `/organizations/${org.id}/teams/${preaching.id}/roles`, { roleIds: [speakers.id] });
  check("given to the Preaching group", r.status === 204 || r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  r = await call(planner, "POST", `${base}/lineup`, { userId: preacher.id, part: "SPEAKER" });
  check("a member of that group speaks at another team's date", r.status === 201, JSON.stringify(r.body));
  r = await call(planner, "POST", `${base}/lineup`, { userId: visitor.id, part: "SPEAKER" });
  check("someone outside the group, not one of the planner's People: not yet", r.status === 400, JSON.stringify(r.body));
  r = await call(planner, "PUT", `/organizations/${org.id}/members/${visitor.id}/roles`, { roleIds: [speakers.id] });
  check("given to them alone, as a one-off", r.status === 204, String(r.status));
  r = await call(planner, "POST", `${base}/lineup`, { userId: visitor.id, part: "SPEAKER" });
  check("…they speak too", r.status === 201, JSON.stringify(r.body));
  const second = await call(planner, "POST", `${base}/lineup`, { guestName: "Pastor Jean", part: "SPEAKER" });
  check("a guest without an account, by name", second.status === 201 && second.body.guest === "external", JSON.stringify(second.body));
  r = await call(planner, "POST", `${base}/lineup`, { guestName: "Someone", part: "DRUMS" });
  check("other parts still take a guest by name", r.status === 201, JSON.stringify(r.body));
  r = await call(planner, "POST", `${base}/lineup`, { userId: musician.id, part: "SPEAKER" });
  check("a member without the role: still not", r.status === 400, JSON.stringify(r.body));
  r = await call(musician, "PUT", `${base}/answer`, { answer: "AVAILABLE", wishes: ["SPEAKER"] });
  check("…nor wishing for it", r.status === 400, JSON.stringify(r.body));
  await call(admin, "DELETE", `/admin/organizations/${org.id}`);
} finally {
  await call(admin, "DELETE", "/admin/organizations/settings");
}
await finish();
