// Manage devices (issue #322): a role that pairs, renames and disconnects a
// team's screens without being its admin - given on the team, or on its
// organisation for all of its teams. It gives nothing over the sets on them,
// nor who owns them.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Managers admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const lead = await user("Managers lead");
const tech = await user("Managers tech");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const role = await api(admin, "POST", "/admin/roles", { name: `Screens manager ${stamp}`, canManageScreens: true, teamAssignable: true });
check("Admin > Roles: a role that manages screens", (await api(admin, "GET", "/admin/roles")).find((one) => one.id === role.id)?.canManageScreens === true);

const org = await api(lead, "POST", "/organizations", { name: `Managers church ${stamp}` });
const team = await api(lead, "POST", "/teams", { name: `Managers band ${stamp}` });
const other = await api(lead, "POST", "/teams", { name: `Managers choir ${stamp}` });
await api(lead, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });
await api(lead, "PUT", `/teams/${other.id}/organization`, { organizationId: org.id });
await call(tech, "POST", `/teams/join/${(await api(lead, "POST", `/teams/${team.id}/invite-links`, {})).token}`);
const teamSet = await api(lead, "POST", "/setlists", { name: `Managers set ${stamp}`, teamId: team.id });

const anonymous = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const pair = async (who, body) => {
  const pairing = (await anonymous("POST", "/screens/pairings")).body;
  return call(who, "POST", `/screens/pairings/${pairing.code}/confirm`, body);
};

let r = await pair(tech, { owner: { kind: "team", id: team.id }, name: "Not yet", mode: "LYRICS", setMode: "DAY" });
check("without the role, a member doesn't pair a screen for the team", r.status === 403, String(r.status));
r = await call(tech, "GET", "/screens/owners");
check("…nor is the team among whose a new screen can be", r.status === 200 && !r.body.teams.some((one) => one.id === team.id), JSON.stringify(r.body));

r = await call(lead, "PUT", `/teams/${team.id}/members/${tech.id}/roles`, { roleIds: [role.id] });
check("the team's admin gives them the role on the team", r.status === 200 || r.status === 204, String(r.status));
r = await call(tech, "GET", "/screens/owners");
check("now the team is among whose a new screen can be", r.body?.teams?.some((one) => one.id === team.id), JSON.stringify(r.body));
r = await pair(tech, { owner: { kind: "team", id: team.id }, name: "Stage left", mode: "LYRICS", setMode: "DAY" });
check("they pair a screen for the team", r.status === 201 && r.body.owner.id === team.id && r.body.canManage === true, JSON.stringify(r.body));
const screen = r.body;
r = await call(tech, "PATCH", `/screens/${screen.id}`, { name: "Stage right" });
check("they rename it", r.status === 200 && r.body.name === "Stage right", String(r.status));
r = await call(tech, "PATCH", `/screens/${screen.id}`, { setlistId: teamSet.id });
check("but don't put a set on it they can't edit", r.status === 403, String(r.status));
r = await call(tech, "PATCH", `/screens/${screen.id}`, { owner: { kind: "user" } });
check("nor give it to someone else", r.status === 403, String(r.status));

const choirScreen = await pair(lead, { owner: { kind: "team", id: other.id }, name: "Choir loft", mode: "LYRICS", setMode: "DAY" });
r = await call(tech, "PATCH", `/screens/${choirScreen.body.id}`, { name: "Mine?" });
check("given on one team: another team's screens aren't theirs", r.status === 404 || r.status === 403, String(r.status));
r = await call(lead, "PUT", `/organizations/${org.id}/members/${tech.id}/roles`, { roleIds: [role.id] });
check("the organisation's admin gives them the role on the organisation", r.status === 200 || r.status === 204, String(r.status));
r = await call(tech, "PATCH", `/screens/${choirScreen.body.id}`, { name: "Choir loft, left" });
check("…then they manage its teams' screens too", r.status === 200 && r.body.name === "Choir loft, left", String(r.status));
const listedScreens = (await call(tech, "GET", "/screens")).body;
check("…and see them in Screens, managing them", listedScreens.find((one) => one.id === choirScreen.body.id)?.canManage === true);

r = await call(tech, "DELETE", `/screens/${screen.id}`);
check("they disconnect a screen", r.status === 204, String(r.status));
await call(lead, "PUT", `/teams/${team.id}/members/${tech.id}/roles`, { roleIds: [] });
await call(lead, "PUT", `/organizations/${org.id}/members/${tech.id}/roles`, { roleIds: [] });
r = await call(tech, "PATCH", `/screens/${choirScreen.body.id}`, { name: "Gone" });
check("the role taken back: no longer theirs", r.status === 404 || r.status === 403, String(r.status));

finish();
