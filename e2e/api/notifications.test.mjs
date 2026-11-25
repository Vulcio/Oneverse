// Notifications (issue #236): people signed up (Available) for a date are
// told when it's cancelled or changes time or title, or when its event is
// deleted; a member is told when an admin answers for them. Whoever made
// the change isn't told. Each person lists theirs, newest first, a page at
// a time, and marks them read.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const today = new Date().toISOString().slice(0, 10);
const plus = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const admin = await user("notify admin");
const singer = await user("notify singer");
const drummer = await user("notify drummer");
const team = (await call(admin, "POST", "/teams", { name: `Notify ${stamp}` })).body;
const join = (who, n) => sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmn${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`);
join(singer, 1);
join(drummer, 2);

const weekly = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Sunday service", date: plus(2), startTime: "10:00", timeZone: "UTC", repeat: { everyWeeks: 1 } })).body;
const first = plus(2);
const second = plus(9);
const base = `/teams/${team.id}/events/${weekly.id}/dates`;
const list = async (who) => (await call(who, "GET", "/users/me/notifications")).body;

let r = await call(singer, "GET", "/users/me/notifications");
check("nothing yet", r.status === 200 && r.body.items.length === 0 && r.body.unread === 0 && r.body.more === false, JSON.stringify(r.body));
r = await call({ bearer: "nope" }, "GET", "/users/me/notifications/unread");
check("signed out: refused", r.status === 401, String(r.status));

await call(singer, "PUT", `${base}/${first}/answer`, { answer: "AVAILABLE" });
await call(singer, "PUT", `${base}/${second}/answer`, { answer: "AVAILABLE" });
await call(drummer, "PUT", `${base}/${first}/answer`, { answer: "IF_NEEDED" });
await call(admin, "PUT", `${base}/${first}/answer`, { answer: "AVAILABLE" });

// --- a date's time changes
await call(admin, "PATCH", `${base}/${first}`, { startTime: "09:30" });
let page = await list(singer);
check("signed up: told the date changed, with its new time", page.unread === 1 && page.items[0].kind === "EVENT_DATE_CHANGED" && page.items[0].data.startTime === "09:30" && page.items[0].data.date === first && page.items[0].data.event === "Sunday service" && page.items[0].data.team === team.name && page.items[0].url === `/events/${weekly.id}/${first}`, JSON.stringify(page));
check("If needed isn't signing up: not told", (await list(drummer)).items.length === 0);
check("whoever made the change isn't told", (await list(admin)).items.length === 0);
r = await call(singer, "GET", "/users/me/notifications/unread");
check("the unread count", r.body.unread === 1, JSON.stringify(r.body));

// --- a change no one would see
await call(admin, "PATCH", `${base}/${first}`, { startTime: "09:30" });
check("the same time again: nothing new", (await list(singer)).items.length === 1);

// --- a date cancelled
await call(admin, "PATCH", `${base}/${first}`, { cancelled: true });
page = await list(singer);
check("cancelled: told, newest first", page.items.length === 2 && page.items[0].kind === "EVENT_DATE_CANCELLED" && page.items[0].data.date === first && page.unread === 2, JSON.stringify(page.items.map((i) => i.kind)));

// --- an admin answers for a member
r = await call(admin, "PUT", `${base}/${plus(16)}/answers/${drummer.id}`, { answer: "UNAVAILABLE" });
page = await list(drummer);
check("answered for: told by whom, and what", r.status === 200 && page.items.length === 1 && page.items[0].kind === "ANSWERED_FOR_YOU" && page.items[0].data.answer === "UNAVAILABLE" && page.items[0].data.by === "notify admin" && page.items[0].data.date === plus(16), JSON.stringify(page.items[0]));
await call(admin, "PUT", `${base}/${plus(16)}/answers/${admin.id}`, { answer: "AVAILABLE" });
check("…not when the admin answers for themselves", (await list(admin)).items.length === 0);

// --- the whole event's title changes: each signed-up coming date
await call(admin, "PATCH", `/teams/${team.id}/events/${weekly.id}`, { title: "Morning service" });
page = await list(singer);
check("the event renamed: told for their coming date, under the new name", page.items[0].kind === "EVENT_DATE_CHANGED" && page.items[0].data.event === "Morning service" && page.items[0].data.date === second && page.items.length === 3, JSON.stringify(page.items.map((i) => [i.kind, i.data.date])));

// --- marking read
r = await call(singer, "POST", "/users/me/notifications/read", { ids: [page.items[0].id] });
check("one marked read", r.status === 201 && r.body.unread === 2, JSON.stringify(r.body));
r = await call(drummer, "POST", "/users/me/notifications/read", { ids: [page.items[1].id] });
r = await call(singer, "GET", "/users/me/notifications/unread");
check("…someone else's can't be", r.body.unread === 2, JSON.stringify(r.body));
r = await call(singer, "POST", "/users/me/notifications/read", { ids: "all" });
check("ids that aren't a list: refused", r.status === 400, String(r.status));
r = await call(singer, "POST", "/users/me/notifications/read", {});
check("all marked read", r.body.unread === 0 && (await list(singer)).items.every((item) => item.read));

// --- the event deleted
await call(admin, "DELETE", `/teams/${team.id}/events/${weekly.id}`);
page = await list(singer);
check("the event deleted: told once", page.items[0].kind === "EVENT_CANCELLED" && page.items[0].data.event === "Morning service" && page.items.filter((i) => i.kind === "EVENT_CANCELLED").length === 1 && page.unread === 1, JSON.stringify(page.items.map((i) => i.kind)));

// --- pages
r = await call(singer, "GET", "/users/me/notifications?limit=2");
check("a page", r.body.items.length === 2 && r.body.more === true, JSON.stringify(r.body));
const next = await call(singer, "GET", `/users/me/notifications?limit=2&before=${r.body.items[1].id}`);
check("…and the next, after it", next.body.items.length === 2 && !next.body.items.some((item) => r.body.items.some((one) => one.id === item.id)) && next.body.more === false, JSON.stringify(next.body.items.map((i) => i.id)));
r = await call(singer, "GET", "/users/me/notifications?limit=500");
check("too many at once: refused", r.status === 400, String(r.status));

finish();
