// Registration for event dates (issue #593): a team's or an organisation's
// event turns registration on - place kinds with their limits and prices,
// questions, a waiting list - and people register for a date on its public
// page, with or without an account, and change or cancel it from the link in
// their email. Places are counted per date and never given twice; a place
// that frees up goes to the first on the waiting list who fits. The event's
// admins, its organiser and whoever has the "Manage registrations" right see
// the list, export it and mark people paid; members don't. An event date can
// last a whole weekend.
import { existsSync, readFileSync } from "node:fs";
import { API, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const WORKER_LOG = process.env.E2E_WORKER_LOG ?? "/tmp/worker.log";
const workerLog = () => (existsSync(WORKER_LOG) ? readFileSync(WORKER_LOG, "utf8") : "");
/** The registration emails sent to `to` after `offset`, waiting for `count` of them. */
async function emailsTo(to, offset, count = 1) {
  for (let i = 0; i < 60; i++) {
    const found = workerLog().slice(offset).split("[email:dev] To: ").slice(1).filter((one) => one.startsWith(to));
    if (found.length >= count) return found;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return [];
}
const anonymous = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const admin = await user("Registrations admin");
const member = await user("Registrations member");
const helper = await user("Registrations helper");
const outsider = await user("Registrations outsider");
const team = (await call(admin, "POST", "/teams", { name: `Weekend church ${stamp}` })).body;
let n = 0;
const join = (teamId, who) => sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmrg${++n}${stamp}', '${teamId}', '${who.id}', 'MEMBER', now(), now()) on conflict do nothing`);
join(team.id, member);
join(team.id, helper);

// --- a weekend: one date over three days
const friday = plus(10);
let r = await call(admin, "POST", `/teams/${team.id}/events`, { title: "Church weekend", date: friday, startTime: "19:00", durationMinutes: 2 * 24 * 60 - 3 * 60, timeZone: "UTC" });
const weekend = r.body;
check("an event date can run from Friday evening to Sunday afternoon", r.status === 201, JSON.stringify(r.body));
r = await call(admin, "POST", `/teams/${team.id}/events`, { title: "Too long", date: friday, startTime: "19:00", durationMinutes: 15 * 24 * 60, timeZone: "UTC" });
check("but not more than 14 days", r.status === 400, JSON.stringify(r.body));

// --- turning registration on
const form = {
  teamEventId: weekend.id,
  limit: 5,
  placeKinds: [
    { name: "Adult", price: 4000 },
    { name: "Child", limit: 2, price: 1500 },
  ],
  currency: "eur",
  questions: [
    { label: "Diet", type: "choice", options: ["None", "Vegetarian"], required: true },
    { label: "Photos allowed", type: "yesno" },
  ],
  intro: "Bring a sleeping bag.",
};
r = await call(member, "PUT", "/registration-forms", form);
check("a member can't turn registration on", r.status === 403, String(r.status));
r = await call(admin, "PUT", "/registration-forms", { ...form, currency: null });
check("a price needs a currency", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "PUT", "/registration-forms", form);
const saved = r.body;
check("the team's admin turns it on", r.status === 200 && saved.placeKinds.length === 2 && saved.currency === "EUR" && saved.questions.length === 2, JSON.stringify(r.body));
check("each place kind and question gets an id, and the page an address in the Oneverse app", saved.placeKinds.every((kind) => kind.id) && saved.questions.every((question) => question.id) && saved.publicUrl.endsWith(`/register/${saved.publicId}`), JSON.stringify(saved));
const [adult, child] = saved.placeKinds.map((kind) => kind.id);
const [diet, photos] = saved.questions.map((question) => question.id);

r = await call(member, "GET", `/registration-forms?teamEventId=${weekend.id}`);
check("a member sees that it's on, without managing it", r.status === 200 && r.body.form?.id === saved.id && r.body.canManage === false, JSON.stringify(r.body));
r = await call(outsider, "GET", `/registration-forms?teamEventId=${weekend.id}`);
check("someone outside the team doesn't see it", r.status === 404, String(r.status));

// --- the public page
r = await anonymous("GET", `/public/registrations/${saved.publicId}`);
check("anyone with the link sees the event, its places and its questions", r.status === 200 && r.body.title === "Church weekend" && r.body.intro === "Bring a sleeping bag." && r.body.dates[0]?.date === friday, JSON.stringify(r.body));
check("the date says it's open, with 5 places left, 2 for children", r.body.dates[0]?.state === "open" && r.body.dates[0]?.left.total === 5 && r.body.dates[0]?.left.byKind[child] === 2, JSON.stringify(r.body.dates[0]));
check("the date runs into Sunday", r.body.dates[0]?.endsAt.slice(0, 10) === plus(12), r.body.dates[0]?.endsAt);
check("the page doesn't say who registered", JSON.stringify(r.body).indexOf("taken") === -1);

// --- registering
const base = `/public/registrations/${saved.publicId}/${friday}`;
r = await anonymous("POST", base, { name: "Ana", email: "ana@example.com", places: { [adult]: 1 } });
check("a required question must be answered", r.status === 400 && /Diet/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
r = await anonymous("POST", base, { name: "Ana", email: "ana@example.com", places: { [child]: 3 }, answers: { [diet]: "None" } });
check("more children than places: waits (there's a waiting list)", r.status === 201 && r.body.status === "WAITING", JSON.stringify(r.body));
const tooMany = r.body.token;
await anonymous("POST", `/public/registration/${tooMany}/cancel`);
r = await anonymous("POST", `/public/registrations/${saved.publicId}/${plus(11)}`, { name: "Ana", email: "ana@example.com", places: { [adult]: 1 }, answers: { [diet]: "None" } });
check("a day the event isn't on: not found", r.status === 404, String(r.status));

let offset = workerLog().length;
const familyEmail = `family-${stamp}@example.com`;
r = await anonymous("POST", base, { name: "The Martins", email: familyEmail, places: { [adult]: 2, [child]: 2 }, answers: { [diet]: "Vegetarian", [photos]: true }, locale: "fr" });
const family = r.body;
check("a family registers without an account: confirmed", r.status === 201 && family.status === "CONFIRMED" && family.price === 11000 && !!family.token, JSON.stringify(r.body));
let [mail] = await emailsTo(familyEmail, offset);
check("they're emailed, in French, with their link", !!mail && /Inscription confirmée : Church weekend/.test(mail) && mail.includes(`/registration/${family.token}`) && /110,00/.test(mail), mail ?? "no email");

r = await call(member, "POST", `/registrations/${saved.publicId}/${friday}`, { name: "Member", email: member.email, places: { [adult]: 1 }, answers: { [diet]: "None" } });
check("a member registers signed in, tied to their account", r.status === 201 && r.body.status === "CONFIRMED", JSON.stringify(r.body));
const mine = r.body;

offset = workerLog().length;
const lateEmail = `late-${stamp}@example.com`;
r = await anonymous("POST", base, { name: "Late couple", email: lateEmail, places: { [adult]: 2 }, answers: { [diet]: "None" } });
const late = r.body;
check("past the limit: on the waiting list", r.status === 201 && late.status === "WAITING", JSON.stringify(r.body));
[mail] = await emailsTo(lateEmail, offset);
check("and told so", !!mail && /On the waiting list/.test(mail), mail ?? "no email");
r = await anonymous("POST", base, { name: "Single", email: `single-${stamp}@example.com`, places: { [adult]: 1 }, answers: { [diet]: "None" } });
check("one more waits behind them", r.body?.status === "WAITING", JSON.stringify(r.body));

// --- the list
r = await call(member, "GET", `/registration-forms/${saved.id}/dates/${friday}`);
check("a member can't see the list", r.status === 403, String(r.status));
r = await call(admin, "GET", `/registration-forms/${saved.id}/dates/${friday}`);
const statuses = (list) => list.registrations.filter((one) => one.status !== "CANCELLED").map((one) => `${one.name}:${one.status}`).join();
check("the admin sees who registered, in order", r.status === 200 && statuses(r.body) === "The Martins:CONFIRMED,Member:CONFIRMED,Late couple:WAITING,Single:WAITING", statuses(r.body ?? { registrations: [] }));
check("with the places taken by kind and those waiting", r.body.date.taken.total === 5 && r.body.date.taken.byKind[child] === 2 && r.body.date.waiting === 2, JSON.stringify(r.body.date));
check("a member's is marked as such", r.body.registrations.find((one) => one.name === "Member")?.member === true);
const familyId = r.body.registrations.find((one) => one.name === "The Martins").id;

const csv = await fetch(`${API}/registration-forms/${saved.id}/dates/${friday}/export`, { headers: { Authorization: `Bearer ${admin.bearer}` } });
const text = await csv.text();
check("the list exports as CSV, a column per kind and question", csv.ok && text.startsWith("Name,Email,Status,Adult,Child,Places,Price,Paid,Diet,Photos allowed,Registered") && text.includes(`The Martins,${familyEmail},CONFIRMED,2,2,4,110.00,no,Vegetarian,yes`), text.slice(0, 300));

r = await call(admin, "PATCH", `/registrations/${familyId}`, { paid: true });
check("the admin marks the family paid", r.status === 200 && r.body.paid === true, JSON.stringify(r.body));
r = await call(member, "PATCH", `/registrations/${familyId}`, { paid: false });
check("a member can't", r.status === 403, String(r.status));

// --- the Manage registrations right, given on the team
const globalAdmin = await user("Registrations global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${globalAdmin.id}'`);
const role = (await call(globalAdmin, "POST", "/admin/roles", { name: `Registrations ${stamp}`, canManageRegistrations: true, teamAssignable: true })).body;
check("Admin > Roles: a role that manages registrations", role?.id && (await call(globalAdmin, "GET", "/admin/roles")).body.find((one) => one.id === role.id)?.canManageRegistrations === true, JSON.stringify(role));
r = await call(admin, "PUT", `/teams/${team.id}/members/${helper.id}/roles`, { roleIds: [role.id] });
check("the team's admin gives it to a helper", r.status === 200 || r.status === 204, JSON.stringify(r.body));
r = await call(helper, "GET", `/registration-forms/${saved.id}/dates/${friday}`);
check("the helper sees the list now", r.status === 200 && r.body.registrations.length >= 4, String(r.status));
r = await call(helper, "GET", `/registration-forms?teamEventId=${weekend.id}`);
check("and manages the registration", r.body?.canManage === true, JSON.stringify(r.body));

// --- changing and cancelling from the link
r = await anonymous("GET", `/public/registration/${family.token}`);
check("the family's link opens their registration", r.status === 200 && r.body.name === "The Martins" && r.body.paid === true && r.body.canChange === true && !r.body.token, JSON.stringify(r.body));
r = await anonymous("PATCH", `/public/registration/${family.token}`, { places: { [adult]: 3, [child]: 2 } });
check("taking more than is left is refused (it isn't sent to wait)", r.status === 409 && r.body.code === "REGISTRATION_FULL", JSON.stringify(r.body));
offset = workerLog().length;
r = await anonymous("PATCH", `/public/registration/${family.token}`, { places: { [adult]: 1, [child]: 2 } });
check("one adult fewer: changed", r.status === 200 && r.body.places[adult] === 1 && r.body.status === "CONFIRMED", JSON.stringify(r.body));
const singleEmail = `single-${stamp}@example.com`;
[mail] = await emailsTo(singleEmail, offset);
check("the freed place goes to the first waiting who fits (the single, not the couple), who's told", !!mail && /There's a place for you/.test(mail), mail ?? "no email");
r = await call(admin, "GET", `/registration-forms/${saved.id}/dates/${friday}`);
check("the list shows it", statuses(r.body) === "The Martins:CONFIRMED,Member:CONFIRMED,Late couple:WAITING,Single:CONFIRMED", statuses(r.body));

offset = workerLog().length;
r = await call(member, "POST", `/public/registration/${mine.token}/cancel`);
check("the member cancels from their link", r.status === 200 && r.body.status === "CANCELLED", JSON.stringify(r.body));
r = await call(admin, "GET", `/registration-forms/${saved.id}/dates/${friday}`);
check("still one place short for the couple: they wait", statuses(r.body) === "The Martins:CONFIRMED,Late couple:WAITING,Single:CONFIRMED", statuses(r.body));
r = await call(admin, "PATCH", `/registrations/${r.body.registrations.find((one) => one.name === "Single").id}`, { cancelled: true });
check("the admin cancels the single's", r.status === 200 && r.body.status === "CANCELLED", JSON.stringify(r.body));
[mail] = await emailsTo(lateEmail, offset);
check("the couple get the two places, and are told", !!mail && /There's a place for you/.test(mail), mail ?? "no email");
r = await call(admin, "GET", `/registration-forms/${saved.id}/dates/${friday}`);
check("the list shows them confirmed", statuses(r.body) === "The Martins:CONFIRMED,Late couple:CONFIRMED", statuses(r.body));

// --- closed: a limit without a waiting list, and the dates
r = await call(admin, "PUT", "/registration-forms", { ...form, waitingList: false, placeKinds: saved.placeKinds, questions: saved.questions });
check("the admin turns the waiting list off; kinds and questions keep their ids", r.status === 200 && r.body.placeKinds[0].id === adult && r.body.questions[0].id === diet, JSON.stringify(r.body));
r = await anonymous("POST", base, { name: "Too late", email: `too-late-${stamp}@example.com`, places: { [adult]: 2 }, answers: { [diet]: "None" } });
check("full, without a waiting list: refused", r.status === 409 && r.body.code === "REGISTRATION_FULL", JSON.stringify(r.body));
await call(admin, "PUT", "/registration-forms", { ...form, placeKinds: saved.placeKinds, questions: saved.questions, opensDaysBefore: 3 });
r = await anonymous("POST", base, { name: "Early", email: `early-${stamp}@example.com`, places: { [adult]: 1 }, answers: { [diet]: "None" } });
check("before it opens: refused", r.status === 409 && r.body.code === "REGISTRATION_NOT_OPEN_YET", JSON.stringify(r.body));
r = await anonymous("GET", `/public/registrations/${saved.publicId}`);
check("the page says when it opens", r.body.dates[0]?.state === "notYet" && !!r.body.dates[0]?.opensAt, JSON.stringify(r.body.dates[0]));
await call(admin, "PUT", "/registration-forms", { ...form, placeKinds: saved.placeKinds, questions: saved.questions, open: false });
r = await anonymous("GET", `/public/registration/${family.token}`);
check("closed: a registration can't change any more", r.body.canChange === false, JSON.stringify(r.body));

// --- an organisation's event: its organiser manages it
await call(globalAdmin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const org = (await call(admin, "POST", "/organizations", { name: `Concert church ${stamp}` })).body;
const welcome = (await call(admin, "POST", `/organizations/${org.id}/groups`, { name: `Concert welcome ${stamp}` })).body;
sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('omrg${stamp}', '${org.id}', '${helper.id}', 'MEMBER', now(), now()) on conflict do nothing`);
r = await call(admin, "POST", `/organizations/${org.id}/events`, { title: "Concert", date: plus(20), startTime: "20:00", timeZone: "UTC", hostUserId: helper.id, needs: [{ teamId: welcome.id }] });
const concert = r.body;
check("an organisation's concert, its organiser a member", r.status === 201, JSON.stringify(r.body));
r = await call(helper, "PUT", "/registration-forms", { organizationEventId: concert.id, limit: 100, placeKinds: [{ name: "Ticket", price: 1200 }, { name: "Bus seat", limit: 50, price: 500 }], currency: "EUR" });
check("its organiser turns registration on", r.status === 200, JSON.stringify(r.body));
const concertForm = r.body;
const groupPart = (await call(admin, "GET", `/teams/${welcome.id}/events`)).body.find((one) => one.organizationEventId === concert.id);
r = await call(admin, "PUT", "/registration-forms", { teamEventId: groupPart.id, placeKinds: [{ name: "Place" }] });
check("a group's part of it can't have its own", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "GET", `/registration-forms?teamEventId=${groupPart.id}`);
check("the group's part shows the organisation's", r.body?.form?.id === concertForm.id, JSON.stringify(r.body));
r = await anonymous("POST", `/public/registrations/${concertForm.publicId}/${plus(20)}`, { name: "Fan", email: `fan-${stamp}@example.com`, places: { [concertForm.placeKinds[0].id]: 2, [concertForm.placeKinds[1].id]: 2 } });
check("someone takes two tickets and two bus seats", r.status === 201 && r.body.price === 3400 && r.body.status === "CONFIRMED", JSON.stringify(r.body));

r = await call(member, "DELETE", `/registration-forms/${saved.id}`);
check("a member can't turn registration off", r.status === 403, String(r.status));
r = await call(admin, "DELETE", `/registration-forms/${saved.id}`);
check("the admin turns it off: its link goes", r.status === 204 && (await anonymous("GET", `/public/registrations/${saved.publicId}`)).status === 404, String(r.status));

finish();
