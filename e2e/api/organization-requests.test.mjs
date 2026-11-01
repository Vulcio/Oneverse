// Asking for an organisation (issue #364): with several organisations and
// anyone allowed, each is asked for - its kind, city, a contact person - and
// reviewed by a global admin, who's told. One that looks like an
// organisation already here or another request (a near name in the same
// city) is refused unless the asker says why it isn't the same. Approved,
// it's made, run by who asked, with a setup checklist for its admins.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const admin = await user("orgreq global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("orgreq alice");
const bob = await user("orgreq bob");
const carol = await user("orgreq carol");
const dan = await user("orgreq dan");
const settings = (data) => call(admin, "PUT", "/admin/organizations/settings", data);
await call(admin, "DELETE", "/admin/organizations/settings");
await settings({ mode: "MULTI", anyoneCreates: true });
const notified = (userId, kind) => sql(`select coalesce(string_agg(data->>'organization' || '|' || coalesce(data->>'note','') || '|' || coalesce(url,''), ','), '') from "Notification" where "userId"='${userId}' and kind='${kind}'`);

// Requests left waiting by an earlier run look like this one's.
sql(`delete from "OrganizationRequest" where name like 'Lighthouse Fellowship %' or name like 'Dan''s %'`);
sql(`delete from "Organization" where name like 'Lighthouse Fellowship %'`);
const name = `Lighthouse Fellowship ${stamp}`;
const ask = (who, extra = {}) =>
  call(who, "POST", "/organizations/requests", { name, kind: "CHURCH", city: "Nantes", contactName: "Alice Martin", contactEmail: "pastor@example.org", website: "https://example.org", peopleCount: "UP_TO_100", ...extra });

// --- reviewed by default once anyone may
let r = await call(alice, "GET", "/organizations");
check("anyone allowed: they ask, reviewed first by default", r.body.canCreate === false && r.body.canRequest === true && Array.isArray(r.body.requests), JSON.stringify(r.body));
r = await call(admin, "GET", "/admin/organizations");
check("Admin: review on, from the default", r.body.settings.reviewRequests.value === true && r.body.settings.reviewRequests.source === "default" && r.body.settings.reviewRequests.env === "ORGANIZATIONS_REVIEWED", JSON.stringify(r.body.settings));
r = await call(alice, "POST", "/organizations", { name });
check("…so not made straight away", r.status === 403, String(r.status));
check("a global admin still creates one", (await call(admin, "GET", "/organizations")).body.canCreate === true && (await call(admin, "GET", "/organizations")).body.canRequest === false);

r = await call(alice, "POST", "/organizations/requests", { name, kind: "CHURCH", contactName: "Alice Martin", contactEmail: "pastor@example.org" });
check("a city is needed", r.status === 400 && r.body.message.some((line) => line.startsWith("city")), JSON.stringify(r.body));
r = await ask(alice, { contactEmail: "not an email" });
check("…and a contact email", r.status === 400, JSON.stringify(r.body));
r = await ask(alice, { website: "javascript:alert(1)" });
check("…a website is an http(s) address", r.status === 400, JSON.stringify(r.body));
r = await ask(alice);
const aliceRequest = r.body;
check("asked: waiting, with what they told", r.status === 201 && aliceRequest.status === "PENDING" && aliceRequest.city === "Nantes" && aliceRequest.contactName === "Alice Martin" && aliceRequest.looksLike.length === 0, JSON.stringify(r.body));
check("global admins are told", notified(admin.id, "ORGANIZATION_REQUESTED").includes(`${name}||/admin/organizations`), notified(admin.id, "ORGANIZATION_REQUESTED"));
r = await call(alice, "GET", "/organizations");
check("…and it's in their requests", r.body.requests.some((one) => one.id === aliceRequest.id && one.status === "PENDING"), JSON.stringify(r.body.requests));

// --- duplicates
r = await call(bob, "POST", "/organizations/requests", { name: `lighthouse  fellowship, ${stamp}!`, kind: "CHURCH", city: "NANTES", contactName: "Bob", contactEmail: "bob@example.org" });
check("the same, spelt differently in the same city: refused with what it looks like", r.status === 409 && r.body.code === "ORGANIZATION_LOOKS_LIKE" && r.body.looksLike.some((one) => one.source === "request" && one.id === aliceRequest.id), JSON.stringify(r.body));
r = await call(bob, "POST", "/organizations/requests", { name: `Lighthouse Fellowship ${stamp}`, kind: "CHURCH", city: "Nantes", contactName: "Bob", contactEmail: "bob@example.org", duplicateNote: "We're the Lighthouse in Rezé, a different church" });
const bobRequest = r.body;
check("…sent when they say why it isn't the same, with what it looked like", r.status === 201 && bobRequest.duplicateNote.startsWith("We're") && bobRequest.looksLike.length === 1, JSON.stringify(r.body));
r = await call(carol, "POST", "/organizations/requests", { name, kind: "CHOIR", city: "Lyon", contactName: "Carol", contactEmail: "carol@example.org" });
const carolRequest = r.body;
check("the same name in another city isn't a duplicate", r.status === 201 && carolRequest.looksLike.length === 0, JSON.stringify(r.body));

// --- at most three waiting each
for (const [what, city] of [["choir", "Brest"], ["chess club", "Toulouse"], ["food bank", "Marseille"]]) {
  await call(dan, "POST", "/organizations/requests", { name: `Dan's ${what} ${stamp}`, kind: "OTHER", city, contactName: "Dan", contactEmail: "dan@example.org" });
}
r = await call(dan, "POST", "/organizations/requests", { name: `Dan's orchestra ${stamp}`, kind: "OTHER", city: "Lille", contactName: "Dan", contactEmail: "dan@example.org" });
check("at most three waiting at once", r.status === 409, JSON.stringify(r.body));

// --- review
r = await call(alice, "GET", "/admin/organizations/requests");
check("only global admins review", r.status === 403, String(r.status));
r = await call(admin, "GET", "/admin/organizations/requests");
const pendingAlice = r.body.pending?.find((one) => one.id === aliceRequest.id);
check("Admin: the requests waiting, who asked, and what each looks like now", r.status === 200 && pendingAlice?.requestedBy.id === alice.id && pendingAlice.looksLike.some((one) => one.id === bobRequest.id) && !pendingAlice.looksLike.some((one) => one.id === aliceRequest.id), JSON.stringify(pendingAlice));
r = await call(admin, "POST", `/admin/organizations/requests/${aliceRequest.id}/approve`);
const organizationId = r.body.organizationId;
check("approved: made", r.status === 201 && typeof organizationId === "string", JSON.stringify(r.body));
r = await call(admin, "POST", `/admin/organizations/requests/${aliceRequest.id}/approve`);
check("…once", r.status === 409, String(r.status));
r = await call(alice, "GET", `/organizations/${organizationId}`);
const made = r.body;
check("run by who asked, with its city and contact", made.currentUserRole === "ADMIN" && made.city === "Nantes" && made.contactEmail === "pastor@example.org" && made.kind === "CHURCH" && made.website === "https://example.org", JSON.stringify(made));
check("…its setup checklist: nothing done yet", made.setup && made.setup.dismissed === false && made.setup.invited === false && made.setup.teams === false && made.setup.roles === false && made.setup.storage === false && typeof made.setup.storageAllowed === "boolean", JSON.stringify(made.setup));
check("who asked is told, the link to its page", notified(alice.id, "ORGANIZATION_APPROVED") === `${name}||/organizations/${organizationId}`, notified(alice.id, "ORGANIZATION_APPROVED"));
check("…and the request is no longer theirs to see", !(await call(alice, "GET", "/organizations")).body.requests.some((one) => one.id === aliceRequest.id));

r = await call(admin, "POST", `/admin/organizations/requests/${bobRequest.id}/decline`, { reason: "Please ask Lighthouse's admins for an invite" });
check("declined", r.status === 204, String(r.status));
check("…who asked is told why", notified(bob.id, "ORGANIZATION_DECLINED") === `${name}|Please ask Lighthouse's admins for an invite|/organizations`, notified(bob.id, "ORGANIZATION_DECLINED"));
r = await call(bob, "GET", "/organizations");
check("…and sees it declined, with the reason", r.body.requests.some((one) => one.id === bobRequest.id && one.status === "DECLINED" && one.declineReason.startsWith("Please")), JSON.stringify(r.body.requests));
r = await call(admin, "GET", "/admin/organizations/requests");
check("Admin: the ones reviewed, by whom", r.body.reviewed.some((one) => one.id === aliceRequest.id && one.status === "APPROVED" && one.reviewedBy.id === admin.id) && r.body.reviewed.some((one) => one.id === bobRequest.id && one.status === "DECLINED"), JSON.stringify(r.body.reviewed));

r = await call(carol, "POST", "/organizations/requests", { name, kind: "CHURCH", city: "Nantes", contactName: "Carol", contactEmail: "carol@example.org" });
check("one like an organisation now here: refused", r.status === 409 && r.body.looksLike.some((one) => one.source === "organization" && one.id === organizationId), JSON.stringify(r.body));

r = await call(bob, "DELETE", `/organizations/requests/${carolRequest.id}`);
check("only who asked withdraws it", r.status === 404, String(r.status));
r = await call(carol, "DELETE", `/organizations/requests/${carolRequest.id}`);
check("withdrawn", r.status === 204 && !(await call(carol, "GET", "/organizations")).body.requests.length, String(r.status));

// --- the checklist
await call(alice, "POST", `/organizations/${organizationId}/invite-links`, { role: "MEMBER" });
await call(alice, "POST", `/organizations/${organizationId}/groups`, { name: `Lighthouse music ${stamp}`, usesSongverse: true });
r = await call(alice, "GET", `/organizations/${organizationId}`);
check("ticked as its admins go: people invited, a team made", r.body.setup.invited === true && r.body.setup.teams === true && r.body.setup.roles === false, JSON.stringify(r.body.setup));
const link = (await call(alice, "GET", `/organizations/${organizationId}/invite-links`)).body[0];
await call(dan, "POST", `/organizations/join/${link.token}`);
r = await call(dan, "GET", `/organizations/${organizationId}`);
check("its members don't see it", r.status === 200 && r.body.setup === null, JSON.stringify(r.body.setup));
r = await call(alice, "PATCH", `/organizations/${organizationId}`, { onboardingDone: true, city: "Nantes (Rezé)", contactName: "" });
check("put away, and its details changed", r.status === 200 && r.body.setup.dismissed === true && r.body.city === "Nantes (Rezé)" && r.body.contactName === null, JSON.stringify(r.body));
r = await call(alice, "PATCH", `/organizations/${organizationId}`, { onboardingDone: false });
check("…and brought back", r.body.setup.dismissed === false, JSON.stringify(r.body.setup));

// --- not reviewed: made straight away, nothing to ask
await settings({ reviewRequests: false });
r = await call(alice, "GET", "/organizations");
check("review off: anyone creates one", r.body.canCreate === true && r.body.canRequest === false, JSON.stringify(r.body));
r = await call(carol, "POST", "/organizations/requests", { name: `Another ${stamp}`, kind: "OTHER", city: "Lyon", contactName: "Carol", contactEmail: "carol@example.org" });
check("…and none is asked for", r.status === 403, String(r.status));

await call(admin, "DELETE", `/admin/organizations/${organizationId}`);
sql(`delete from "OrganizationRequest" where "requestedById" in ('${alice.id}','${bob.id}','${carol.id}','${dan.id}')`);
await call(admin, "DELETE", "/admin/organizations/settings");
finish();
