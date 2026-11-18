// Who may host an organisation's dates (issue #520): its admins make a
// role that hosts and give it to one of its groups ("Présidence") - every
// member of that group can then be the Host on the dates of the
// organisation's teams - or, as a one-off, to one person outside it.
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

  const event = (await call(orgAdmin, "POST", `/teams/${music.id}/events`, { title: "Sunday", date: plus(3), startTime: "10:00", timeZone: "UTC", parts: [{ part: "HOST", count: 1 }, { part: "DRUMS", count: 1 }] })).body;
  const base = `/teams/${music.id}/events/${event.id}/dates/${plus(3)}`;
  let r = await call(orgAdmin, "POST", `${base}/lineup`, { userId: presider.id, part: "HOST" });
  check("without the role: nobody hosts", r.status === 400, JSON.stringify(r.body));

  const hosts = (await call(orgAdmin, "POST", `/organizations/${org.id}/roles`, { name: "Hosts", canHost: true })).body;
  check("the organisation's own role that hosts", hosts.canHost === true, JSON.stringify(hosts));
  r = await call(orgAdmin, "PUT", `/organizations/${org.id}/teams/${presidency.id}/roles`, { roleIds: [hosts.id] });
  check("given to the Présidence group", r.status === 204 || r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  r = await call(orgAdmin, "POST", `${base}/lineup`, { userId: presider.id, part: "HOST" });
  check("a member of that group hosts another team's date", r.status === 201, JSON.stringify(r.body));
  r = await call(orgAdmin, "POST", `${base}/lineup`, { userId: visitor.id, part: "HOST" });
  check("someone outside the group: not yet", r.status === 400, JSON.stringify(r.body));
  r = await call(orgAdmin, "PUT", `/organizations/${org.id}/members/${visitor.id}/roles`, { roleIds: [hosts.id] });
  check("given to them alone, as a one-off", r.status === 204, String(r.status));
  r = await call(orgAdmin, "POST", `${base}/lineup`, { userId: visitor.id, part: "HOST" });
  check("…they host too", r.status === 201, JSON.stringify(r.body));
  const answers = (await call(orgAdmin, "GET", `${base}/answers`)).body;
  check("the team's own members: no hosting", answers.find((one) => one.userId === musician.id)?.givenParts.length === 0, JSON.stringify(answers));
  r = await call(musician, "PUT", `${base}/answer`, { answer: "AVAILABLE", wishes: ["HOST"] });
  check("…nor wishing for it", r.status === 400, JSON.stringify(r.body));
  await call(admin, "DELETE", `/admin/organizations/${org.id}`);
} finally {
  await call(admin, "DELETE", "/admin/organizations/settings");
}
await finish();
