// Organisations (issue #241, Planiverse): an instance has none (Songverse
// alone, the default), several, or one that everyone is in - Admin >
// Organisations. An organisation's admins put their teams in it (the
// team's members join it), invite people by link, choose its admins and
// take people or teams out; deleting it leaves its teams on their own.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const admin = await user("org global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("org alice");
const bob = await user("org bob");
const carol = await user("org carol");
const dan = await user("org dan");
const settings = (data) => call(admin, "PUT", "/admin/organizations/settings", data);
await call(admin, "DELETE", "/admin/organizations/settings");

// --- none: Songverse alone
let r = await call(alice, "GET", "/organizations");
check("by default, no organisations: Songverse alone", r.status === 200 && r.body.mode === "NONE" && r.body.organizations.length === 0 && r.body.canCreate === false, JSON.stringify(r.body));
r = await call(alice, "POST", "/organizations", { name: "Too early" });
check("…none can be made", r.status === 404, String(r.status));
r = await call(admin, "GET", "/admin/organizations");
check("Admin: the mode, from the default", r.status === 200 && r.body.settings.mode.value === "NONE" && r.body.settings.mode.source === "default" && r.body.settings.mode.env === "ORGANIZATION_MODE", JSON.stringify(r.body.settings));
r = await call(alice, "PUT", "/admin/organizations/settings", { mode: "MULTI" });
check("only global admins change it", r.status === 403, String(r.status));
r = await settings({ mode: "SEVERAL" });
check("a mode that isn't: refused", r.status === 400, JSON.stringify(r.body));

// --- several
await settings({ mode: "MULTI" });
r = await call(alice, "GET", "/organizations");
check("several: only global admins create one, by default", r.body.mode === "MULTI" && r.body.canCreate === false, JSON.stringify(r.body));
r = await call(alice, "POST", "/organizations", { name: "Grace Church" });
check("…so not anyone", r.status === 403, String(r.status));
await settings({ anyoneCreates: true });
r = await call(alice, "POST", "/organizations", { name: `Grace Church ${stamp}`, description: "Sundays at 10" });
const org = r.body;
check("anyone may, when Admin says so: its creator its admin", r.status === 201 && org.currentUserRole === "ADMIN" && org.slug.startsWith("grace-church") && org.memberCount === 1, JSON.stringify(r.body));
r = await call(alice, "POST", "/organizations", { name: `Grace Church ${stamp}`, adminEmail: bob.email });
check("someone else as its admin: Admin only", r.status === 400, JSON.stringify(r.body));
const twin = (await call(alice, "POST", "/organizations", { name: `Grace Church ${stamp}` })).body;
check("the same name: another slug", twin.slug === `${org.slug}-2`, twin.slug);
await call(alice, "DELETE", `/organizations/${twin.id}`);

// --- its teams
const music = (await call(alice, "POST", "/teams", { name: `Music ${stamp}` })).body;
const teamLink = (await call(alice, "POST", `/teams/${music.id}/invite-links`, {})).body;
await call(bob, "POST", `/teams/join/${teamLink.token}`);
const own = (await call(carol, "POST", "/teams", { name: `Carol's band ${stamp}` })).body;
r = await call(carol, "PUT", `/teams/${own.id}/organization`, { organizationId: org.id });
check("a team's admin who isn't the organisation's: can't put it in", r.status === 403, String(r.status));
r = await call(bob, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
check("a team's member: can't either", r.status === 403, String(r.status));
r = await call(alice, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
check("both the team's and the organisation's admin: the team is in it", r.status === 200 && r.body.organization?.id === org.id && r.body.organization.name === org.name, JSON.stringify(r.body));
r = await call(bob, "GET", "/organizations");
check("…and its members are the organisation's", r.body.organizations.some((one) => one.id === org.id && one.currentUserRole === "MEMBER"), JSON.stringify(r.body));
check("…the team shows it", (await call(bob, "GET", "/teams")).body.find((team) => team.id === music.id)?.organization?.id === org.id);
await call(dan, "POST", `/teams/join/${teamLink.token}`);
check("joining one of its teams: in the organisation too", (await call(dan, "GET", "/organizations")).body.organizations.some((one) => one.id === org.id));

// --- invite links
r = await call(bob, "POST", `/organizations/${org.id}/invite-links`, {});
check("only its admins invite", r.status === 403, String(r.status));
const link = (await call(alice, "POST", `/organizations/${org.id}/invite-links`, { maxUses: 1 })).body;
r = await call(carol, "POST", `/organizations/join/${link.token}`);
check("joined by its link", r.status === 201 && r.body.id === org.id && r.body.currentUserRole === "MEMBER", JSON.stringify(r.body));
r = await call(admin, "POST", `/organizations/join/${link.token}`);
check("…once only, if so made", r.status === 403, String(r.status));
r = await call(carol, "GET", `/organizations/${org.id}`);
check("a member sees its teams, theirs marked", r.status === 200 && r.body.teams.length === 1 && r.body.teams[0].id === music.id && r.body.teams[0].mine === false && r.body.memberCount === 4, JSON.stringify(r.body));
r = await call(admin, "GET", `/organizations/${org.id}/members`);
check("global admins see any", r.status === 200 && r.body.length === 4, String(r.status));
const stranger = await user("org stranger");
r = await call(stranger, "GET", `/organizations/${org.id}`);
check("someone outside it: not found", r.status === 404, String(r.status));
r = await call(carol, "PATCH", `/organizations/${org.id}`, { name: "Mine now" });
check("members don't change it", r.status === 403, String(r.status));
r = await call(alice, "PATCH", `/organizations/${org.id}`, { description: "", color: "teal" });
check("its admins do: the description cleared, a colour", r.status === 200 && r.body.description === null && r.body.color === "teal", JSON.stringify(r.body));

// --- its people
r = await call(carol, "PATCH", `/organizations/${org.id}/members/${bob.id}`, { role: "ADMIN" });
check("members don't choose admins", r.status === 403, String(r.status));
r = await call(alice, "PATCH", `/organizations/${org.id}/members/${alice.id}`, { role: "MEMBER" });
check("its last admin stays one", r.status === 409, String(r.status));
r = await call(alice, "PATCH", `/organizations/${org.id}/members/${bob.id}`, { role: "ADMIN" });
check("another admin", r.status === 200 && r.body.role === "ADMIN", JSON.stringify(r.body));
r = await call(bob, "DELETE", `/organizations/${org.id}/members/${alice.id}`);
check("taking out the only admin of one of its teams: refused, by name", r.status === 409 && String(r.body.message).includes("Music"), JSON.stringify(r.body));
r = await call(bob, "DELETE", `/organizations/${org.id}/members/${dan.id}`);
check("someone taken out of it…", r.status === 204, String(r.status));
check("…is out of its teams too", (await call(dan, "GET", "/teams")).body.every((team) => team.id !== music.id));
r = await call(carol, "POST", `/organizations/${org.id}/leave`);
check("leaving it", r.status === 204 && (await call(carol, "GET", "/organizations")).body.organizations.every((one) => one.id !== org.id), String(r.status));

// --- a team out, then the organisation gone
r = await call(bob, "DELETE", `/organizations/${org.id}/teams/${music.id}`);
check("its admins take a team out: on its own again", r.status === 204 && (await call(alice, "GET", `/teams/${music.id}`)).body.organization === null, String(r.status));
await call(alice, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
r = await call(admin, "GET", "/admin/organizations");
const listed = r.body.organizations.find((one) => one.id === org.id);
check("Admin lists it, with its admins and counts", listed?.teamCount === 1 && listed.memberCount === 2 && listed.admins.map((a) => a.email).sort().join() === [alice.email, bob.email].sort().join() && r.body.source === "database", JSON.stringify(listed));
r = await call(alice, "DELETE", `/organizations/${org.id}`);
check("deleted by its admins: its teams stay, on their own", r.status === 204 && (await call(alice, "GET", `/teams/${music.id}`)).body.organization === null, String(r.status));

// --- one organisation for the instance
sql(`delete from "Organization"`);
await settings({ mode: "SINGLE", anyoneCreates: null });
r = await call(alice, "GET", "/organizations");
check("one: none made yet, and only a global admin makes it", r.body.mode === "SINGLE" && r.body.organizations.length === 0 && r.body.canCreate === false, JSON.stringify(r.body));
check("…who can", (await call(admin, "GET", "/organizations")).body.canCreate === true);
r = await call(admin, "POST", "/admin/organizations", { name: `Our church ${stamp}`, adminEmail: alice.email });
const only = r.body;
check("Admin makes it, someone else its admin", r.status === 201 && only.admins.length === 1 && only.admins[0].id === alice.id, JSON.stringify(r.body));
r = await call(admin, "POST", "/admin/organizations", { name: "A second one" });
check("…only one", r.status === 409, String(r.status));
r = await call(carol, "GET", "/organizations");
check("everyone is in it, the first time they look", r.body.organizations.length === 1 && r.body.organizations[0].id === only.id && r.body.organizations[0].currentUserRole === "MEMBER", JSON.stringify(r.body));
r = await call(carol, "POST", `/organizations/${only.id}/leave`);
check("…and can't leave it", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "DELETE", `/admin/organizations/${only.id}`);
check("Admin deletes it", r.status === 204, String(r.status));

r = await call(admin, "DELETE", "/admin/organizations/settings");
check("back to the environment variables: none", r.status === 204 && (await call(alice, "GET", "/organizations")).body.mode === "NONE", String(r.status));

finish();
