// Whose a screen is (issue #222): a person's, a team's or an organisation's.
// A team's admins pair one for the team; its members see it and put a set
// they lead on it - it then reads that set as them - but don't rename or
// disconnect it. Given to the organisation, its members see it too. A team
// deleted takes its screens with it.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Owner admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const lead = await user("Owner lead");
const member = await user("Owner member");
const outsider = await user("Owner outsider");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const org = await api(lead, "POST", "/organizations", { name: `Screens church ${stamp}` });
const team = await api(lead, "POST", "/teams", { name: `Screens band ${stamp}` });
await api(lead, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });
await call(member, "POST", `/teams/join/${(await api(lead, "POST", `/teams/${team.id}/invite-links`, {})).token}`);
const teamSet = await api(lead, "POST", "/setlists", { name: `Team set ${stamp}`, teamId: team.id });
const memberSet = await api(member, "POST", "/setlists", { name: `Member set ${stamp}` });

const anonymous = async (method, path, body, headers = {}) => {
  const res = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const pair = async (who, body) => {
  const pairing = (await anonymous("POST", "/screens/pairings")).body;
  const r = await call(who, "POST", `/screens/pairings/${pairing.code}/confirm`, body);
  const claimed = r.status === 201 ? (await anonymous("POST", `/screens/pairings/${pairing.pairingId}/claim`, { secret: pairing.secret })).body : null;
  return { r, token: claimed?.token };
};
const listed = async (who) => (await call(who, "GET", "/screens")).body;

// --- a team's screen
let { r } = await pair(member, { owner: { kind: "team", id: team.id }, name: "Not mine", mode: "LYRICS", setlistId: memberSet.id });
check("only a team's admins pair a screen for it", r.status === 403, String(r.status));
const paired = await pair(lead, { owner: { kind: "team", id: team.id }, name: "Hall projector", mode: "LYRICS", setlistId: teamSet.id });
r = paired.r;
check("its admin pairs one for the team", r.status === 201 && r.body.owner.kind === "team" && r.body.owner.id === team.id && r.body.owner.name === team.name && r.body.canManage, JSON.stringify(r.body));
const screen = r.body;
let mine = (await listed(member)).find((one) => one.id === screen.id);
check("its members see it, without managing it", mine && mine.canManage === false && mine.owner.kind === "team");
check("someone outside doesn't", !(await listed(outsider)).some((one) => one.id === screen.id));
r = await call(member, "PATCH", `/screens/${screen.id}`, { name: "Mine now" });
check("a member doesn't rename it", r.status === 403, String(r.status));
r = await call(member, "DELETE", `/screens/${screen.id}`);
check("nor disconnect it", r.status === 403, String(r.status));
r = await call(member, "PATCH", `/screens/${screen.id}`, { setlistId: memberSet.id });
check("a member puts a set they lead on it", r.status === 200 && r.body.setlistId === memberSet.id, JSON.stringify(r.body));
r = await anonymous("GET", "/screens/current", null, { Authorization: `Screen ${paired.token}` });
check("…and the screen reads it as them", r.status === 200 && JSON.stringify(r.body.set ?? null).includes(`Member set ${stamp}`), JSON.stringify(Object.keys(r.body?.set ?? {})));
r = await call(member, "PATCH", `/screens/${screen.id}`, { setlistId: teamSet.id });
check("not a set they can't lead", r.status === 403, String(r.status));

// --- given to the organisation
r = await call(member, "PATCH", `/screens/${screen.id}`, { owner: { kind: "organization", id: org.id } });
check("a member doesn't give it away", r.status === 403, String(r.status));
r = await call(lead, "PATCH", `/screens/${screen.id}`, { owner: { kind: "organization", id: org.id } });
check("its admin, who runs the organisation, gives it to the organisation", r.status === 200 && r.body.owner.kind === "organization" && r.body.owner.name === org.name, JSON.stringify(r.body.owner));
await call(outsider, "POST", `/organizations/join/${(await api(lead, "POST", `/organizations/${org.id}/invite-links`, {})).token}`);
mine = (await listed(outsider)).find((one) => one.id === screen.id);
check("the organisation's members see it now", mine?.owner.kind === "organization" && mine.canManage === false, JSON.stringify(mine));
r = await call(lead, "PATCH", `/screens/${screen.id}`, { owner: { kind: "team", id: team.id } });
check("…and back to the team", r.status === 200 && r.body.owner.kind === "team");

// --- one's own, and a team deleted
const own = (await pair(member, { name: "My laptop", mode: "LYRICS", setlistId: memberSet.id })).r.body;
check("one's own, by default", own.owner.kind === "user" && own.owner.id === member.id && own.canManage);
check("…only theirs to see", !(await listed(lead)).some((one) => one.id === own.id));
await call(lead, "DELETE", `/teams/${team.id}`);
check("a team deleted: its screens go too", sql(`select count(*) from "Screen" where id='${screen.id}'`) === "0");
check("one's own stays", sql(`select count(*) from "Screen" where id='${own.id}'`) === "1");

await api(admin, "DELETE", "/admin/organizations/settings");
finish();
