// Who may host (issue #520): on a team's own events, whoever its admins
// name. On an organisation's events, only those a role lets host: its
// admins make a role that hosts and give it to one of its groups
// ("Présidence") - every member of that group can then be the Host there -
// or, as a one-off, to one person outside it.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Org hosts admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const orgAdmin = await user("Org hosts planner");
const presider = await user("Org hosts presider");
const visitor = await user("Org hosts visitor");
const musician = await user("Org hosts musician");
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
try {
  const org = (await call(orgAdmin, "POST", "/organizations", { name: `Hosts church ${stamp}` })).body;
  const music = (await call(orgAdmin, "POST", `/organizations/${org.id}/groups`, { name: `Music ${stamp}`, usesSongverse: true })).body;
  const presidency = (await call(orgAdmin, "POST", `/organizations/${org.id}/groups`, { name: `Présidence ${stamp}` })).body;
  const join = (who, teamId, n) => {
    sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('omh${n}${stamp}', '${org.id}', '${who.id}', 'MEMBER', now(), now()) on conflict do nothing`);
    if (teamId) sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmh${n}${stamp}', '${teamId}', '${who.id}', 'MEMBER', now(), now())`);
  };
  join(presider, presidency.id, 1);
  join(musician, music.id, 2);
  join(visitor, null, 3);

  // A team's own event: its admins name whoever they like.
  const own = (await call(orgAdmin, "POST", `/teams/${music.id}/events`, { title: "Rehearsal", date: plus(4), startTime: "19:00", timeZone: "UTC", parts: [{ part: "HOST", count: 1 }] })).body;
  const ownBase = `/teams/${music.id}/events/${own.id}/dates/${plus(4)}`;
  let r0 = await call(musician, "PUT", `${ownBase}/answer`, { answer: "AVAILABLE", wishes: ["HOST"] });
  check("a team's own event: any member may wish to host", r0.status === 200 && r0.body.wishes.join() === "HOST", JSON.stringify(r0.body));
  r0 = await call(orgAdmin, "POST", `${ownBase}/lineup`, { userId: musician.id, part: "HOST" });
  check("…and its admins put whoever they like on it", r0.status === 201, JSON.stringify(r0.body));
  r0 = await call(orgAdmin, "POST", `${ownBase}/lineup`, { guestName: "Visiting pastor", part: "HOST" });
  check("…but never a guest: hosting is a member's", r0.status === 400, JSON.stringify(r0.body));
  r0 = await call(orgAdmin, "POST", `${ownBase}/lineup`, { userId: visitor.id, part: "HOST" });
  check("…someone of the team's organisation, though, yes", r0.status === 201, JSON.stringify(r0.body));

  // The organisation's event: hosts by a role.
  const made = (await call(orgAdmin, "POST", `/organizations/${org.id}/events`, { title: "Sunday", date: plus(3), startTime: "10:00", timeZone: "UTC", hostUserId: orgAdmin.id, needs: [{ teamId: music.id, parts: [{ part: "HOST", count: 1 }, { part: "DRUMS", count: 1 }] }] })).body;
  const event = (await call(orgAdmin, "GET", `/teams/${music.id}/events`)).body.find((one) => one.organizationEventId === made.id);
  check("the organisation's event, on the music group's calendar", !!event, JSON.stringify(made));
  const base = `/teams/${music.id}/events/${event.id}/dates/${plus(3)}`;
  let r = await call(orgAdmin, "POST", `${base}/lineup`, { userId: presider.id, part: "HOST" });
  check("without the role: nobody hosts", r.status === 400, JSON.stringify(r.body));

  const hosts = (await call(orgAdmin, "POST", `/organizations/${org.id}/roles`, { name: "Hosts", canHost: true })).body;
  check("the organisation's own role that hosts", hosts.canHost === true, JSON.stringify(hosts));
  r = await call(orgAdmin, "PUT", `/organizations/${org.id}/teams/${presidency.id}/roles`, { roleIds: [hosts.id] });
  check("given to the Présidence group", r.status === 204 || r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  r = await call(orgAdmin, "POST", `${base}/lineup`, { userId: presider.id, part: "HOST" });
  check("a member of that group hosts the organisation's event", r.status === 201, JSON.stringify(r.body));
  r = await call(orgAdmin, "POST", `${base}/lineup`, { userId: visitor.id, part: "HOST" });
  check("someone outside the group: not yet", r.status === 400, JSON.stringify(r.body));
  r = await call(orgAdmin, "PUT", `/organizations/${org.id}/members/${visitor.id}/roles`, { roleIds: [hosts.id] });
  check("given to them alone, as a one-off", r.status === 204, String(r.status));
  r = await call(orgAdmin, "POST", `${base}/lineup`, { userId: visitor.id, part: "HOST" });
  check("…they host too", r.status === 201, JSON.stringify(r.body));
  const answers = (await call(orgAdmin, "GET", `${base}/answers`)).body;
  check("the group's own members: no hosting there", answers.find((one) => one.userId === musician.id)?.givenParts.length === 0, JSON.stringify(answers));
  r = await call(musician, "PUT", `${base}/answer`, { answer: "AVAILABLE", wishes: ["HOST"] });
  check("…nor wishing for it", r.status === 400, JSON.stringify(r.body));
  await call(admin, "DELETE", `/admin/organizations/${org.id}`);
} finally {
  await call(admin, "DELETE", "/admin/organizations/settings");
}
await finish();
