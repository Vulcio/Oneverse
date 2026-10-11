// Scheduling by part (issue #235, phase 7): a team's admins put members on
// the parts a date needs; each is told, then accepts or declines (declining
// tells the admins; accepting says they're available). The admins see
// clashes - away, said not available, playing elsewhere then - and what's
// still short. Once a date has a line-up, the people on it (not declining)
// are who signed up: the sidebar, the calendar link.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("lineup admin");
const drummer = await user("lineup drummer");
const singer = await user("lineup singer");
const sound = await user("lineup sound");
const bassist = await user("lineup bassist");
const outsider = await user("lineup outsider");
sql(`update "User" set instruments='{DRUMS}' where id='${drummer.id}'`);
sql(`update "User" set instruments='{BACKING_VOCALS}' where id='${singer.id}'`);
sql(`update "User" set "techRoles"='{SOUND_ENGINEER}' where id='${sound.id}'`);
const team = (await call(admin, "POST", "/teams", { name: `Lineup ${stamp}` })).body;
const join = (who, n) => sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tml${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`);
[drummer, singer, sound, bassist].forEach((who, n) => join(who, n));

const date = plus(3);
const event = (await call(admin, "POST", `/teams/${team.id}/events`, {
  title: "Sunday",
  date,
  startTime: "10:00",
  timeZone: "UTC",
  parts: [
    { part: "DRUMS", count: 1 },
    { part: "BACKING_VOCALS", count: 2 },
    { part: "SOUND_ENGINEER", count: 1 },
  ],
})).body;
// Another of the team's events at the same time: playing both is a clash.
const other = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Youth", date, startTime: "10:30", timeZone: "UTC", parts: [{ part: "DRUMS", count: 1 }] })).body;
const base = `/teams/${team.id}/events/${event.id}/dates/${date}`;
await call(drummer, "PUT", `${base}/answer`, { answer: "AVAILABLE" });
await call(singer, "PUT", `${base}/answer`, { answer: "IF_NEEDED" });
await call(sound, "PUT", `${base}/answer`, { answer: "UNAVAILABLE" });
await call(bassist, "PUT", `${base}/answer`, { answer: "AVAILABLE" });
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);
const dateAs = async (who) => (await call(who, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`)).body.find((one) => one.eventId === event.id);
const setOf = async (who) => (await call(who, "GET", "/setlists")).body.find((set) => set.fromEvent && set.name === "Sunday");
check("before a line-up: answering Available signs up", (await setOf(bassist))?.signedUp === true, JSON.stringify(await setOf(bassist)));

// --- scheduling
let r = await call(drummer, "POST", `${base}/lineup`, { userId: drummer.id, part: "DRUMS" });
check("members don't schedule", r.status === 403, String(r.status));
r = await call(admin, "POST", `${base}/lineup`, { userId: drummer.id, part: "PIANO" });
check("a part the event doesn't need: refused", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "POST", `${base}/lineup`, { userId: outsider.id, part: "DRUMS" });
check("someone outside the team: refused", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "POST", `${base}/lineup`, { userId: drummer.id, part: "DRUMS" });
const drums = r.body;
check("a member scheduled: asked", r.status === 201 && drums.status === "PENDING" && drums.displayName === "lineup drummer", JSON.stringify(r.body));
r = await call(admin, "POST", `${base}/lineup`, { userId: drummer.id, part: "DRUMS" });
check("…twice: refused", r.status === 409, String(r.status));
const asked = (await notes(drummer, "SCHEDULED"))[0];
check("…and told: the part, the date", asked?.data.part === "DRUMS" && asked.data.date === date && asked.data.event === "Sunday" && asked.url === "/calendar", JSON.stringify(asked));
r = await call(admin, "POST", `${base}/lineup`, { userId: sound.id, part: "SOUND_ENGINEER" });
const soundPlace = r.body;
await call(admin, "POST", `/teams/${team.id}/events/${other.id}/dates/${date}/lineup`, { userId: drummer.id, part: "DRUMS" });
r = await call(admin, "POST", `${base}/lineup`, { userId: admin.id, part: "BACKING_VOCALS" });
check("an admin scheduling themselves: accepted at once, not told", r.body.status === "ACCEPTED" && (await notes(admin, "SCHEDULED")).length === 0, JSON.stringify(r.body));

// --- what the admins see
let seen = await dateAs(admin);
const placeOf = (who) => seen.lineup.find((place) => place.userId === who.id);
check("the line-up, by part", seen.lineup.length === 3 && placeOf(drummer).partKey === "DRUMS", JSON.stringify(seen.lineup));
check("clash: playing elsewhere at the same time", placeOf(drummer).conflicts.includes("ELSEWHERE"), JSON.stringify(placeOf(drummer)));
check("clash: said not available", placeOf(sound).conflicts.includes("UNAVAILABLE"), JSON.stringify(placeOf(sound)));
const cover = Object.fromEntries(seen.coverage.map((part) => [part.key, part]));
check("short of who's scheduled, once there's a line-up", cover.DRUMS.scheduled === 1 && cover.DRUMS.missing === 0 && cover.BACKING_VOCALS.scheduled === 1 && cover.BACKING_VOCALS.missing === 1, JSON.stringify(seen.coverage));
seen = await dateAs(singer);
check("members see who's on what, not the clashes", seen.lineup.length === 3 && seen.lineup.every((place) => place.conflicts.length === 0 && !place.mine), JSON.stringify(seen.lineup));

// --- signed up: the line-up
check("once there's a line-up: Available alone no longer signs up", (await setOf(bassist))?.signedUp === false);
check("…being asked does", (await setOf(drummer))?.signedUp === true);

// --- answering
r = await call(singer, "PUT", `${base}/lineup/${drums.id}/response`, { status: "ACCEPTED" });
check("only the person scheduled answers", r.status === 404, String(r.status));
r = await call(drummer, "PUT", `${base}/lineup/${drums.id}/response`, { status: "DECLINED", note: "Away that weekend" });
check("declined, with a note", r.status === 200 && r.body.status === "DECLINED" && r.body.note === "Away that weekend", JSON.stringify(r.body));
const declined = (await notes(admin, "SCHEDULE_DECLINED"))[0];
check("the admins are told who can't, and what", declined?.data.by === "lineup drummer" && declined.data.part === "DRUMS" && declined.url === `/teams/${team.id}`, JSON.stringify(declined));
check("declining: no longer signed up", (await setOf(drummer))?.signedUp === false);
check("the admins see the note", (await dateAs(admin)).lineup.find((place) => place.id === drums.id).note === "Away that weekend");
r = await call(drummer, "PUT", `${base}/lineup/${drums.id}/response`, { status: "ACCEPTED" });
check("changed their mind: accepted", r.body.status === "ACCEPTED" && (await setOf(drummer))?.signedUp === true);
check("…which says they're available", (await dateAs(drummer)).myAnswer.answer === "AVAILABLE");
r = await call(drummer, "PUT", `${base}/lineup/${drums.id}/response`, { status: "PENDING" });
check("an answer that isn't one: refused", r.status === 400, String(r.status));

// --- taken off
r = await call(admin, "DELETE", `${base}/lineup/${soundPlace.id}`);
const off = (await notes(sound, "UNSCHEDULED"))[0];
check("taken off: told", r.status === 204 && off?.data.part === "SOUND_ENGINEER", JSON.stringify(off));

// --- My calendar, the calendar link
const mine = (await call(drummer, "GET", `/users/me/event-dates?from=${date}&to=${date}`)).body.find((one) => one.eventId === event.id);
check("My calendar: their place, to answer", mine.lineup.some((place) => place.mine && place.partKey === "DRUMS" && place.status === "ACCEPTED") && mine.parts.length === 3, JSON.stringify(mine.lineup));
const feedOf = async (who) => {
  const { url } = (await call(who, "POST", "/users/me/calendar-feed")).body;
  return (await fetch(url)).text();
};
check("the calendar link: those on the line-up", (await feedOf(drummer)).includes(`${event.id}-${date}`));
check("…not those only available", !(await feedOf(bassist)).includes(`${event.id}-${date}`));

finish();
