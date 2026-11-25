// One date of an event moved to another day (issue #576): the series keeps
// its pattern, the date shows on its new day saying where it came from, and
// its answers, line-up and set go with it, and its rehearsals follow. Those signed up
// are told. A day the event already has a date on is refused; moving it back
// to its own day makes it an ordinary date again. A set made for a date
// follows the date: its own date can't be changed on the set. An
// organisation's event moves the date for every group it needs.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);
const admin = await user("Move admin");
const singer = await user("Move singer");
const drummer = await user("Move drummer");
const outsider = await user("Move outsider");
const team = (await call(admin, "POST", "/teams", { name: `Move band ${stamp}` })).body;
let n = 0;
const join = (teamId, who) => sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmmv${++n}${stamp}', '${teamId}', '${who.id}', 'MEMBER', now(), now()) on conflict do nothing`);
join(team.id, singer);
join(team.id, drummer);

const first = plus(7);
const second = plus(14);
const third = plus(21);
const to = plus(13);
const base = `/teams/${team.id}/events`;
const datesBetween = async (who, from, until) => (await call(who, "GET", `/teams/${team.id}/event-dates?from=${from}&to=${until}`)).body;

const weekly = (await call(admin, "POST", `${base}`, { title: "Sunday", date: first, startTime: "10:00", timeZone: "UTC", repeat: { everyWeeks: 1 }, parts: [{ part: "DRUMS", count: 1 }] })).body;
const rehearsal = (await call(admin, "POST", `${base}`, { title: "Practice", date: plus(5), startTime: "19:00", timeZone: "UTC", rehearsalFor: { eventId: weekly.id, daysBefore: 2 } })).body;
const dates = `${base}/${weekly.id}/dates`;

// --- what goes with it
let r = await call(singer, "PUT", `${dates}/${second}/answer`, { answer: "AVAILABLE", note: "Keys" });
check("the singer answers the second Sunday", r.status === 200, JSON.stringify(r.body));
r = await call(admin, "POST", `${dates}/${second}/lineup`, { userId: drummer.id, part: "DRUMS" });
check("the drummer is on its line-up", r.status === 201 || r.status === 200, JSON.stringify(r.body));
r = await call(admin, "POST", `${dates}/${second}/set`);
const setlistId = r.body.setlistId;
check("it has a set", !!setlistId, JSON.stringify(r.body));

// --- who may move it, and where
r = await call(singer, "POST", `${dates}/${second}/move`, { to });
check("a member can't move a date", r.status === 403, String(r.status));
r = await call(outsider, "POST", `${dates}/${second}/move`, { to });
check("someone outside the team can't either", r.status === 403, String(r.status));
r = await call(admin, "POST", `${dates}/${second}/move`, { to: third });
check("a day the event has a date on already: refused", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "POST", `${dates}/${plus(15)}/move`, { to });
check("a day the event isn't on can't be moved", r.status === 400 || r.status === 404, JSON.stringify(r.body));
r = await call(admin, "POST", `${base}/${rehearsal.id}/dates/${plus(12)}/move`, { to: plus(11) });
check("a rehearsal follows its event: it isn't moved on its own", r.status === 400, JSON.stringify(r.body));

// --- moved
r = await call(admin, "POST", `${dates}/${second}/move`, { to });
check("the admin moves the second Sunday to the Saturday before", r.status === 201 || r.status === 200, JSON.stringify(r.body));
check("it answers the date on its new day, saying where it came from", r.body?.date === to && r.body?.movedFrom === second, JSON.stringify(r.body));
let shown = await datesBetween(admin, first, third);
let mine = shown.filter((one) => one.eventId === weekly.id);
check("the series shows it on its new day and not its old one", mine.map((one) => one.date).join() === [first, to, third].join(), JSON.stringify(mine.map((one) => one.date)));
check("the date says it moved", mine.find((one) => one.date === to)?.movedFrom === second, JSON.stringify(mine));
const practice = shown.find((one) => one.eventId === rehearsal.id && one.date === plus(11));
check("its rehearsal moves with it, two days before the new day", !!practice && !shown.some((one) => one.eventId === rehearsal.id && one.date === plus(12)), JSON.stringify(shown.filter((one) => one.eventId === rehearsal.id)));
r = await call(admin, "GET", `${dates}/${to}/answers`);
check("the singer's answer went with it", JSON.stringify(r.body).includes(singer.id) && JSON.stringify(r.body).includes("Keys"), JSON.stringify(r.body));
check("the line-up went with it", JSON.stringify(mine.find((one) => one.date === to)).includes(drummer.id), JSON.stringify(mine.find((one) => one.date === to)));
check("the set went with it", mine.find((one) => one.date === to)?.setlistId === setlistId, JSON.stringify(mine.find((one) => one.date === to)));
r = await call(admin, "GET", `/setlists/${setlistId}`);
check("the set's date is the new day", String(r.body?.eventDate ?? "").startsWith(to), JSON.stringify(r.body?.eventDate));
const told = await notes(drummer, "EVENT_DATE_MOVED");
check("the drummer on its line-up is told, with both days", told.length === 1 && !!told[0].data?.to, JSON.stringify(told));
check("the singer who answered is told too", (await notes(singer, "EVENT_DATE_MOVED")).length === 1);
check("the admin who moved it isn't", (await notes(admin, "EVENT_DATE_MOVED")).length === 0);

// --- the set follows the date
r = await call(admin, "PATCH", `/setlists/${setlistId}`, { eventDate: plus(20) });
check("the set's date can't be changed on the set", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "PATCH", `/setlists/${setlistId}`, { name: `Moved Sunday ${stamp}` });
check("its other details still can", r.status === 200, JSON.stringify(r.body));

// --- moved again, then back
r = await call(admin, "POST", `${dates}/${to}/move`, { to: plus(12) });
check("moved again, it still says its own day", r.body?.date === plus(12) && r.body?.movedFrom === second, JSON.stringify(r.body));
r = await call(admin, "POST", `${dates}/${plus(12)}/move`, { to: second });
check("moved back to its own day, it's an ordinary date again", r.body?.date === second && r.body?.movedFrom === null, JSON.stringify(r.body));
mine = (await datesBetween(admin, first, third)).filter((one) => one.eventId === weekly.id);
check("the series is as it was", mine.map((one) => one.date).join() === [first, second, third].join() && mine.every((one) => !one.movedFrom), JSON.stringify(mine.map((one) => [one.date, one.movedFrom])));
check("with its set", mine.find((one) => one.date === second)?.setlistId === setlistId);

// --- an organisation's event
const globalAdmin = await user("Move global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${globalAdmin.id}'`);
await call(globalAdmin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const org = (await call(admin, "POST", "/organizations", { name: `Move church ${stamp}` })).body;
const music = (await call(admin, "POST", `/organizations/${org.id}/groups`, { name: `Move music ${stamp}`, usesSongverse: true })).body;
const welcome = (await call(admin, "POST", `/organizations/${org.id}/groups`, { name: `Move welcome ${stamp}` })).body;
r = await call(admin, "POST", `/organizations/${org.id}/events`, {
  title: "Easter",
  date: first,
  startTime: "10:00",
  timeZone: "UTC",
  repeat: { everyWeeks: 1 },
  hostUserId: admin.id,
  needs: [{ teamId: music.id }, { teamId: welcome.id }],
});
const easter = r.body;
check("an organisation's weekly event for two groups", r.status === 201, JSON.stringify(r.body));
const part = async (teamId) => (await call(admin, "GET", `/teams/${teamId}/events`)).body.find((one) => one.organizationEventId === easter.id);
const musicPart = await part(music.id);
r = await call(admin, "POST", `/teams/${music.id}/events/${musicPart.id}/dates/${second}/move`, { to });
check("a group's date of it moves only from the organisation", r.status === 400 || r.status === 403, JSON.stringify(r.body));
r = await call(admin, "POST", `/organizations/${org.id}/events/${easter.id}/dates/${second}/move`, { to });
check("the organisation moves it", r.status === 204, JSON.stringify(r.body));
for (const group of [music, welcome]) {
  const own = await part(group.id);
  const days = (await call(admin, "GET", `/teams/${group.id}/event-dates?from=${first}&to=${third}`)).body.filter((one) => one.eventId === own.id);
  check(`${group === music ? "Music" : "Welcome"} has it on the new day`, days.map((one) => one.date).join() === [first, to, third].join() && days[1].movedFrom === second, JSON.stringify(days.map((one) => [one.date, one.movedFrom])));
}
r = await call(singer, "POST", `/organizations/${org.id}/events/${easter.id}/dates/${third}/move`, { to: plus(20) });
check("only its admins or organiser move it", r.status === 403 || r.status === 404, String(r.status));

finish();
