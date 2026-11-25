// One event date's page (issue #575): /users/me/event-dates/:eventId/:date
// gives a date of one's calendar as My calendar does - one's answer, the
// line-up, the set - with the event's note and its rehearsals for that
// date. Only for the team's members (and a guest on its line-up); the
// notifications about a date lead to its page, /events/:eventId/:date.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);
const admin = await user("Page admin");
const drummer = await user("Page drummer");
const outsider = await user("Page outsider");
const team = (await call(admin, "POST", "/teams", { name: `Page band ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmpg1${stamp}', '${team.id}', '${drummer.id}', 'MEMBER', now(), now())`);

const date = plus(10);
const sunday = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Sunday", date, startTime: "10:00", timeZone: "UTC", note: "Bring the in-ears", repeat: { everyWeeks: 1 }, parts: [{ part: "DRUMS", count: 1 }, { part: "BASS_GUITAR", count: 1 }] })).body;
const practice = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Practice", date: plus(8), startTime: "19:00", timeZone: "UTC", rehearsalFor: { eventId: sunday.id, daysBefore: 2 } })).body;
const page = (who, eventId = sunday.id, day = date) => call(who, "GET", `/users/me/event-dates/${eventId}/${day}`);

// --- the date, as on one's calendar
let r = await page(drummer);
check("a member opens a date of the team", r.status === 200 && r.body.eventId === sunday.id && r.body.date === date && r.body.title === "Sunday" && r.body.teamName === team.name, JSON.stringify(r.body));
check("with the event's note", r.body.note === "Bring the in-ears", JSON.stringify(r.body.note));
check("its rehearsal, two days before", r.body.rehearsals?.length === 1 && r.body.rehearsals[0].eventId === practice.id && r.body.rehearsals[0].date === plus(8), JSON.stringify(r.body.rehearsals));
check("its set", !!r.body.setlistId, JSON.stringify(r.body.setlistId));
check("a member isn't its admin", r.body.isAdmin === false && (await page(admin)).body.isAdmin === true);
r = await page(outsider);
check("someone outside the team: not found", r.status === 404, String(r.status));
r = await page(drummer, sunday.id, plus(11));
check("a day the event isn't on: not found", r.status === 404, String(r.status));
r = await page(drummer, sunday.id, "2026-02-31");
check("a date that isn't one: refused", r.status === 400, String(r.status));

// --- answered and scheduled, from its page
r = await call(drummer, "PUT", `/teams/${team.id}/events/${sunday.id}/dates/${date}/answer`, { answer: "AVAILABLE" });
check("answered", r.status === 200, JSON.stringify(r.body));
r = await call(admin, "POST", `/teams/${team.id}/events/${sunday.id}/dates/${date}/lineup`, { userId: drummer.id, part: "DRUMS" });
check("put on the line-up", r.status === 201 || r.status === 200, JSON.stringify(r.body));
r = await page(drummer);
check("the page has the answer and the line-up", r.body.myAnswer.answer === "AVAILABLE" && r.body.lineup.some((place) => place.mine && place.partKey === "DRUMS"), JSON.stringify([r.body.myAnswer, r.body.lineup]));
const scheduled = (await notes(drummer, "SCHEDULED"))[0];
check("the notification leads to the date's page", scheduled?.url === `/events/${sunday.id}/${date}`, JSON.stringify(scheduled));

// --- someone without an account on the line-up
r = await call(admin, "POST", `/teams/${team.id}/events/${sunday.id}/dates/${date}/lineup`, { guestName: "Visiting bassist", guestEmail: `bassist-${stamp}@example.com`, part: "BASS_GUITAR" });
check("someone without an account on it too", r.status === 201 || r.status === 200, JSON.stringify(r.body));
check("…on the page", (await page(drummer)).body.lineup.some((place) => place.displayName === "Visiting bassist"));

// --- the rehearsal's own page
r = await page(drummer, practice.id, plus(8));
check("those signed up open its rehearsal, which says what it's for", r.status === 200 && r.body.rehearsalFor?.eventId === sunday.id && r.body.rehearsalFor.date === date && r.body.rehearsals.length === 0, JSON.stringify(r.body));

// --- cancelled: still its page, saying so
await call(admin, "PATCH", `/teams/${team.id}/events/${sunday.id}/dates/${date}`, { cancelled: true });
r = await page(drummer);
check("a cancelled date's page says so", r.status === 200 && r.body.cancelled === true, JSON.stringify(r.body));
const cancelled = (await notes(drummer, "EVENT_DATE_CANCELLED"))[0];
check("…and its notification leads there", cancelled?.url === `/events/${sunday.id}/${date}`, JSON.stringify(cancelled));

finish();
