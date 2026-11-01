// The Bible in the sidebar (issue #310): a team's admins turn it on for its
// members, an organisation's admins for its teams' members; off by default,
// and a member can't turn it on.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const admin = await user("bible switch admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const leader = await user("bible switch leader");
const member = await user("bible switch member");
const team = (await call(leader, "POST", "/teams", { name: `Bible switch band ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('tmbible${stamp}', '${team.id}', '${member.id}', 'MEMBER', now())`);

let r = await call(leader, "GET", `/teams/${team.id}`);
check("off by default", r.status === 200 && r.body.bible === false, JSON.stringify(r.body));
r = await call(member, "PATCH", `/teams/${team.id}`, { bible: true });
check("a member can't turn it on", r.status === 403, String(r.status));
r = await call(leader, "PATCH", `/teams/${team.id}`, { bible: "yes" });
check("on or off, nothing else", r.status === 400, JSON.stringify(r.body));
r = await call(leader, "PATCH", `/teams/${team.id}`, { bible: true });
check("the team's admin turns it on", r.status === 200 && r.body.bible === true, JSON.stringify(r.body));
r = await call(member, "GET", "/teams");
check("its members see it on, in their teams", r.body.find((one) => one.id === team.id)?.bible === true, JSON.stringify(r.body));
r = await call(leader, "PATCH", `/teams/${team.id}`, { bible: false });
check("and off again", r.status === 200 && r.body.bible === false, JSON.stringify(r.body));

// An organisation's: for its teams' members.
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
try {
  const org = (await call(leader, "POST", "/organizations", { name: `Bible church ${stamp}` })).body;
  r = await call(member, "PATCH", `/organizations/${org.id}`, { bible: true });
  check("an organisation's: not by someone outside it", r.status === 403 || r.status === 404, String(r.status));
  r = await call(leader, "PATCH", `/organizations/${org.id}`, { bible: true });
  check("its admin turns it on", r.status === 200 && r.body.bible === true, JSON.stringify(r.body));
  r = await call(leader, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });
  check("a team put in it", r.status === 200, JSON.stringify(r.body));
  r = await call(member, "GET", "/teams");
  check("the team's members see it on through the organisation", r.body.find((one) => one.id === team.id)?.organization?.bible === true, JSON.stringify(r.body));
  await call(admin, "DELETE", `/admin/organizations/${org.id}`);
} finally {
  await call(admin, "DELETE", "/admin/organizations/settings");
}

finish();
