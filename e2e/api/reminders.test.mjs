// Reminders (issue #235, as notifications #236): a team admin asks for
// answers by a deadline - members missing some are told, not the ones
// away, not the asker - and the day before it they're reminded; the day
// before a date, the people signed up are reminded (from 18:00 in its
// zone); "the set is ready". The timed ones are run by the hourly job,
// run now here through Admin > Background jobs.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const utcToday = new Date().toISOString().slice(0, 10);
const plus = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const until = async (test, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};
// A zone where it's now between 18:00 and 22:00: the day-before reminder for tomorrow there is due.
const zone = (() => {
  const hour = new Date().getUTCHours();
  for (let offset = -12; offset <= 14; offset++) {
    const local = (((hour + offset) % 24) + 24) % 24;
    if (local >= 18 && local <= 22) return offset === 0 ? "UTC" : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
  }
  throw new Error("no zone");
})();
const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const tomorrow = plus(localToday, 1);

const admin = await user("rem admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const singer = await user("rem singer");
const drummer = await user("rem drummer");
const bassist = await user("rem bassist");
const team = (await call(admin, "POST", "/teams", { name: `Reminders ${stamp}` })).body;
const join = (who, n) => sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmr${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`);
join(singer, 1);
join(drummer, 2);
join(bassist, 3);
const weekly = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Evening service", date: tomorrow, startTime: "10:00", callMinutes: 30, timeZone: zone, place: "Main hall", repeat: { everyWeeks: 1, until: plus(tomorrow, 14) } })).body;
const base = `/teams/${team.id}/events/${weekly.id}/dates`;
await call(singer, "PUT", `${base}/${tomorrow}/answer`, { answer: "AVAILABLE" });
await call(bassist, "POST", "/users/me/away", { from: utcToday, to: plus(utcToday, 30), note: "Tour" });
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);

// --- asking for answers
const ask = { from: utcToday, to: plus(utcToday, 20), deadline: utcToday, timeZone: "UTC" };
let r = await call(singer, "POST", `/teams/${team.id}/answer-requests`, ask);
check("only the team's admins ask", r.status === 403, String(r.status));
r = await call(admin, "POST", `/teams/${team.id}/answer-requests`, { ...ask, deadline: plus(utcToday, -1) });
check("a deadline already gone: refused", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "POST", `/teams/${team.id}/answer-requests`, { ...ask, to: plus(utcToday, -2), deadline: plus(utcToday, -2) });
check("to before from: refused, by name", r.status === 400 && r.body.message.some((m) => m.startsWith("to ")), JSON.stringify(r.body));
r = await call(admin, "POST", `/teams/${team.id}/answer-requests`, ask);
const request = r.body;
check("answers asked for: the members missing some told, not the one away", r.status === 201 && request.notified === 2 && request.createdBy === "rem admin", JSON.stringify(r.body));
const asked = (await notes(drummer, "ANSWERS_REQUESTED"))[0];
check("…by whom, by when, how many", asked?.data.by === "rem admin" && asked.data.deadline === utcToday && asked.data.count === 3 && asked.data.team === team.name && asked.url === "/calendar", JSON.stringify(asked));
check("…the singer, for the two they haven't answered", (await notes(singer, "ANSWERS_REQUESTED"))[0]?.data.count === 2);
check("…not the one away, not the asker", (await notes(bassist, "ANSWERS_REQUESTED")).length === 0 && (await notes(admin, "ANSWERS_REQUESTED")).length === 0);
r = await call(singer, "GET", `/teams/${team.id}/answer-requests`);
check("members see what's asked, by when", r.status === 200 && r.body.length === 1 && r.body[0].deadline === utcToday && r.body[0].to === ask.to, JSON.stringify(r.body));

// --- the set is ready
r = await call(singer, "POST", `${base}/${tomorrow}/set-ready`);
check("only admins say the set is ready", r.status === 403, String(r.status));
r = await call(admin, "POST", `${base}/${tomorrow}/set-ready`);
check("the set is ready: the people signed up told", r.status === 201 && r.body.notified === 1 && r.body.setReadyAt, JSON.stringify(r.body));
const ready = (await notes(singer, "SET_READY"))[0];
check("…where it leads: the set", ready?.url?.startsWith("/sets/") && ready.data.event === "Evening service" && ready.data.date === tomorrow && ready.data.count === 0, JSON.stringify(ready));
check("…not those who didn't sign up", (await notes(drummer, "SET_READY")).length === 0);
r = await call(admin, "GET", `/teams/${team.id}/event-dates?from=${tomorrow}&to=${tomorrow}`);
check("the date shows its set ready", !!r.body[0]?.setReadyAt, JSON.stringify(r.body[0]));
await call(admin, "PATCH", `${base}/${plus(tomorrow, 7)}`, { cancelled: true });
r = await call(admin, "POST", `${base}/${plus(tomorrow, 7)}/set-ready`);
check("a date without a set: refused", r.status === 400, String(r.status));
await call(admin, "PATCH", `${base}/${plus(tomorrow, 7)}`, { cancelled: false });

// A rehearsal tomorrow, a week before the next date (phase 7): those signed up for that date are reminded of it.
const keys = await user("rem keys");
join(keys, 4);
await call(keys, "PUT", `${base}/${plus(tomorrow, 7)}/answer`, { answer: "AVAILABLE" });
const practice = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Band practice", date: tomorrow, startTime: "19:00", timeZone: zone, rehearsalFor: { eventId: weekly.id, daysBefore: 7 } })).body;

// --- the hourly job, run now
r = await call(singer, "POST", "/admin/jobs/run/event-reminders");
check("only global admins run jobs", r.status === 403, String(r.status));
r = await call(admin, "POST", "/admin/jobs/run/nope");
check("a job that isn't: 404", r.status === 404, String(r.status));
r = await call(admin, "POST", "/admin/jobs/run/event-reminders");
check("the reminders run now", r.status === 201 && r.body.queued === "event-reminders", JSON.stringify(r.body));
check("the day before (18:00 or later where it happens): the people signed up reminded", await until(async () => (await notes(singer, "EVENT_TOMORROW")).length === 1), zone);
const tomorrowNote = (await notes(singer, "EVENT_TOMORROW"))[0];
check("…when, when to be there (issue #240), where, and the set", tomorrowNote?.data.startTime === "10:00" && tomorrowNote.data.callTime === "09:30" && tomorrowNote.data.place === "Main hall" && tomorrowNote.data.date === tomorrow && tomorrowNote.url?.startsWith("/sets/"), JSON.stringify(tomorrowNote));
check("…a rehearsal tomorrow: those signed up for its date", await until(async () => (await notes(keys, "EVENT_TOMORROW")).some((note) => note.data.event === "Band practice" && note.data.startTime === "19:00" && note.url?.startsWith("/sets/"))), JSON.stringify(await notes(keys, "EVENT_TOMORROW")));
check("…only them", (await notes(singer, "EVENT_TOMORROW")).every((note) => note.data.event !== "Band practice") && practice.rehearsalFor?.daysBefore === 7);
check("the deadline today: those still missing answers reminded, with how many", await until(async () => (await notes(drummer, "ANSWER_DEADLINE")).length === 1 && (await notes(drummer, "ANSWER_DEADLINE"))[0].data.count === 3));
check("…the singer too, not the one away", (await notes(singer, "ANSWER_DEADLINE"))[0]?.data.count === 2 && (await notes(bassist, "ANSWER_DEADLINE")).length === 0);
check("…marked reminded", sql(`select "remindedAt" is not null from "TeamAnswerRequest" where id='${request.id}'`) === "t");

await call(admin, "POST", "/admin/jobs/run/event-reminders");
await new Promise((resolve) => setTimeout(resolve, 2000));
check("run again: nothing twice", (await notes(singer, "EVENT_TOMORROW")).length === 1 && (await notes(drummer, "ANSWER_DEADLINE")).length === 1);

r = await call(admin, "DELETE", `/teams/${team.id}/answer-requests/${request.id}`);
check("a request removed", r.status === 204 && (await call(admin, "GET", `/teams/${team.id}/answer-requests`)).body.length === 0);

finish();
