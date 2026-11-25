// Resources (issue #564): what an organisation or a team owns that events book besides rooms - the van, the PA -
// how many there are and maybe the venue they're kept at. Their owner's admins make and change them; members see
// them. A team's event takes the team's or its organisation's, an organisation's event the organisation's, and an
// event type keeps its usual ones; never more than there are.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("Resources global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const lead = await user("Resources lead");
const member = await user("Resources member");
const stranger = await user("Resources stranger");
const org = (await call(lead, "POST", "/organizations", { name: `Resource church ${stamp}` })).body;
const team = (await call(lead, "POST", "/teams", { name: `Resource team ${stamp}` })).body;
await call(lead, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });
await call(member, "POST", `/teams/join/${(await call(lead, "POST", `/teams/${team.id}/invite-links`, { role: "MEMBER" })).body.token}`);
const elsewhere = (await call(stranger, "POST", "/teams", { name: `Elsewhere ${stamp}` })).body;
const campus = (await call(lead, "POST", "/locations", { name: "Campus", timeZone: "Europe/Paris", organizationId: org.id })).body;

// --- making them
let r = await call(member, "POST", "/resources", { name: "Drum kit", teamId: team.id });
check("only the team's admins add its resources", r.status === 403, String(r.status));
r = await call(lead, "POST", "/resources", { name: "Both", teamId: team.id, organizationId: org.id });
check("a team's or an organisation's, not both", r.status === 400, JSON.stringify(r.body));
r = await call(lead, "POST", "/resources", { name: "Van", organizationId: org.id, locationId: campus.id });
const van = r.body;
check("an organisation's, kept at its venue, one of it", r.status === 201 && van.quantity === 1 && van.location?.name === "Campus" && van.owner.kind === "organization" && van.canEdit, JSON.stringify(r.body));
r = await call(lead, "POST", "/resources", { name: "Wireless mics", quantity: 6, teamId: team.id });
const mics = r.body;
check("a team's, six of them", r.status === 201 && mics.quantity === 6, JSON.stringify(r.body));
r = await call(lead, "POST", "/resources", { name: "Elsewhere", teamId: team.id, locationId: "nowhere" });
check("kept only at one of its owner's venues", r.status === 400, JSON.stringify(r.body));
r = await call(lead, "PATCH", `/resources/${mics.id}`, { quantity: 4 });
check("changed", r.status === 200 && r.body.quantity === 4, JSON.stringify(r.body));
r = await call(member, "GET", `/resources?teamId=${team.id}`);
check("its members see the team's and the organisation's", r.status === 200 && r.body.length === 2 && r.body.every((one) => !one.canEdit), JSON.stringify(r.body));
r = await call(stranger, "GET", `/resources?teamId=${team.id}`);
check("nobody else", r.status === 404, String(r.status));

// --- events take them
const event = { title: `Outreach ${stamp}`, date: plus(5), startTime: "10:00", durationMinutes: 120, timeZone: "Europe/Paris" };
r = await call(lead, "POST", `/teams/${team.id}/events`, { ...event, resources: [{ resourceId: van.id }, { resourceId: mics.id, quantity: 3 }] });
const outreach = r.body;
check("a team's event takes its own and its organisation's", r.status === 201 && outreach.resources?.length === 2 && outreach.resources.find((one) => one.name === "Wireless mics")?.quantity === 3, JSON.stringify(r.body));
r = await call(lead, "PATCH", `/teams/${team.id}/events/${outreach.id}`, { resources: [{ resourceId: mics.id, quantity: 5 }] });
check("never more than there are", r.status === 400 && r.body.message.some((m) => m.includes("only 4")), JSON.stringify(r.body));
r = await call(lead, "PATCH", `/teams/${team.id}/events/${outreach.id}`, { resources: [{ resourceId: mics.id, quantity: 2 }] });
check("changed: the van given back", r.status === 200 && r.body.resources.length === 1 && r.body.resources[0].quantity === 2, JSON.stringify(r.body));
const strangers = (await call(stranger, "POST", "/resources", { name: "Their PA", teamId: elsewhere.id })).body;
r = await call(lead, "POST", `/teams/${team.id}/events`, { ...event, resources: [{ resourceId: strangers.id }] });
check("not another team's", r.status === 400, JSON.stringify(r.body));
const base = `/organizations/${org.id}`;
r = await call(lead, "POST", `${base}/events`, { ...event, hostUserId: lead.id, needs: [{ teamId: team.id }], resources: [{ resourceId: van.id }] });
check("an organisation's event takes the organisation's", r.status === 201 && r.body.resources?.[0]?.resourceId === van.id, JSON.stringify(r.body));
r = await call(lead, "POST", `${base}/events`, { ...event, hostUserId: lead.id, needs: [{ teamId: team.id }], resources: [{ resourceId: mics.id }] });
check("…not one of its groups'", r.status === 400, JSON.stringify(r.body));
r = await call(lead, "POST", `/teams/${team.id}/event-types`, { name: `Outreach ${stamp}`, resources: [{ resourceId: mics.id, quantity: 4 }] });
check("an event type keeps its usual ones", r.status === 201 && r.body.resources?.[0]?.quantity === 4, JSON.stringify(r.body));

// --- removing one
r = await call(lead, "DELETE", `/resources/${mics.id}`);
check("removed by its admin", r.status === 204, String(r.status));
r = await call(lead, "GET", `/teams/${team.id}/events/${outreach.id}`);
check("its events no longer take it", r.status === 200 && r.body.resources.length === 0, JSON.stringify(r.body));

finish();
