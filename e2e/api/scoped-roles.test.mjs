// Roles given on a team or an organisation only (issue #270): Admin decides
// which roles teams can give; a team's admins give them to its members, an
// organisation's admins to theirs. The built-in Media operator runs the
// screens of that team's sets - or the organisation's teams' - without
// editing them, and nowhere else; and what Admin gives a user stays apart.
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

const admin = await user("Scoped admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const leader = await user("Scoped leader");
const desk = await user("Scoped desk");
const stranger = await user("Scoped stranger");

const band = await api(leader, "POST", "/teams", { name: `Scoped band ${stamp}` });
const other = await api(leader, "POST", "/teams", { name: `Other band ${stamp}` });
for (const team of [band, other]) {
  const link = await api(leader, "POST", `/teams/${team.id}/invite-links`, { role: "MEMBER" });
  await api(desk, "POST", `/teams/join/${link.token}`);
}
const bandSet = await api(leader, "POST", "/setlists", { name: `Band set ${stamp}`, teamId: band.id });
const otherSet = await api(leader, "POST", "/setlists", { name: `Other set ${stamp}`, teamId: other.id });

let r = await call(admin, "GET", "/admin/roles");
const media = r.body.find((role) => role.id === "role_media_operator");
check("a built-in Media operator role: runs screens, teams can give it", media?.builtIn === "MEDIA_OPERATOR" && media.canOperateScreens === true && media.teamAssignable === true, JSON.stringify(media));

r = await call(leader, "GET", `/teams/${band.id}/roles`);
check("the team's admin sees the roles teams can give, and its members", r.status === 200 && r.body.roles.some((role) => role.id === media.id) && !r.body.roles.some((role) => role.id === "role_audio_uploads") && r.body.members.some((one) => one.userId === desk.id), JSON.stringify(r.body));
r = await call(desk, "GET", `/teams/${band.id}/roles`);
check("a member doesn't", r.status === 403, String(r.status));

r = await call(leader, "PUT", `/teams/${band.id}/members/${desk.id}/roles`, { roleIds: ["role_audio_uploads"] });
check("a role teams can't give: refused", r.status === 400, `${r.status} ${JSON.stringify(r.body?.message)}`);
r = await call(leader, "PUT", `/teams/${band.id}/members/${stranger.id}/roles`, { roleIds: [media.id] });
check("someone outside the team: not found", r.status === 404, String(r.status));
r = await call(desk, "PUT", `/teams/${band.id}/members/${desk.id}/roles`, { roleIds: [media.id] });
check("a member can't give it to themselves", r.status === 403, String(r.status));
r = await call(leader, "PUT", `/teams/${band.id}/members/${desk.id}/roles`, { roleIds: [media.id] });
check("the team's admin gives it", r.status === 204, String(r.status));
r = await call(leader, "GET", `/teams/${band.id}/roles`);
check("…listed as theirs here", r.body.members.find((one) => one.userId === desk.id)?.roleIds.join() === media.id, JSON.stringify(r.body.members));
r = await call(leader, "GET", `/teams/${other.id}/roles`);
check("…not on the other team", r.body.members.find((one) => one.userId === desk.id)?.roleIds.length === 0, JSON.stringify(r.body.members));

// Admin replacing the user's own roles leaves the team's alone, and doesn't show it as theirs everywhere.
await api(admin, "PUT", `/admin/users/${desk.id}/roles`, { roleIds: ["role_audio_uploads"] });
r = await call(leader, "GET", `/teams/${band.id}/roles`);
check("Admin setting their own roles keeps the team's", r.body.members.find((one) => one.userId === desk.id)?.roleIds.join() === media.id, JSON.stringify(r.body.members));
r = await call(admin, "GET", "/admin/users");
const listed = (r.body.users ?? r.body).find?.((one) => one.id === desk.id);
check("Admin > Users shows only what's given everywhere", listed && !JSON.stringify(listed).includes("Media operator"), JSON.stringify(listed).slice(0, 300));

const devices = [];
async function canPresent(who, setId) {
  const device = await syncDevice(who);
  devices.push(device);
  device.send({ type: "join", setId });
  const session = await device.next((m) => m.type === "session");
  return { canPresent: session?.canPresent, canLead: session?.canLead };
}
try {
  let seen = await canPresent(desk, bandSet.id);
  check("on the team's set: runs the screens, without editing it", seen.canPresent === true && seen.canLead === false, JSON.stringify(seen));
  seen = await canPresent(desk, otherSet.id);
  check("on another team's set: doesn't", seen.canPresent === false, JSON.stringify(seen));

  // An organisation's admins give it on all its teams.
  await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
  const org = await api(leader, "POST", "/organizations", { name: `Scoped church ${stamp}` });
  await api(leader, "PUT", `/teams/${other.id}/organization`, { organizationId: org.id });
  r = await call(stranger, "GET", `/organizations/${org.id}/roles`);
  check("an organisation's roles: not for someone outside it", r.status === 404, String(r.status));
  r = await call(leader, "GET", `/organizations/${org.id}/roles`);
  check("its admin sees its members", r.status === 200 && r.body.members.some((one) => one.userId === desk.id), JSON.stringify(r.body));
  r = await call(leader, "PUT", `/organizations/${org.id}/members/${desk.id}/roles`, { roleIds: [media.id] });
  check("its admin gives it", r.status === 204, String(r.status));
  seen = await canPresent(desk, otherSet.id);
  check("on its teams' sets: runs the screens", seen.canPresent === true && seen.canLead === false, JSON.stringify(seen));
  r = await call(leader, "PUT", `/organizations/${org.id}/members/${desk.id}/roles`, { roleIds: [] });
  check("taken back", r.status === 204);
  seen = await canPresent(desk, otherSet.id);
  check("…and it's gone", seen.canPresent === false, JSON.stringify(seen));
  await call(admin, "DELETE", `/admin/organizations/${org.id}`);
} finally {
  for (const device of devices) device.close?.();
  await call(admin, "DELETE", "/admin/organizations/settings");
}

r = await call(admin, "PATCH", `/admin/roles/${media.id}`, { teamAssignable: false });
r = await call(leader, "GET", `/teams/${band.id}/roles`);
check("Admin stops teams giving it: it's no longer offered", !r.body.roles.some((role) => role.id === media.id), JSON.stringify(r.body.roles));
await call(admin, "PATCH", `/admin/roles/${media.id}`, { teamAssignable: true });

finish();
