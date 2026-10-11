// The parts an event needs (issue #235, phase 7): instruments and roles
// members list on their dashboard (or an admin's custom instruments), or
// names of the team's own, each with how many; for the admins, each date's
// coverage - who covers each part available or if needed, how many short.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("parts admin");
const drummer = await user("parts drummer");
const singer = await user("parts singer");
const sound = await user("parts sound");
sql(`update "User" set instruments='{DRUMS}' where id='${drummer.id}'`);
sql(`update "User" set instruments='{BACKING_VOCALS,LEAD_VOCALS}' where id='${singer.id}'`);
sql(`update "User" set "techRoles"='{SOUND_ENGINEER}' where id='${sound.id}'`);
const team = (await call(admin, "POST", "/teams", { name: `Parts ${stamp}` })).body;
const join = (who, n) => sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmp${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`);
join(drummer, 1);
join(singer, 2);
join(sound, 3);

const date = plus(3);
const parts = [
  { part: "DRUMS", count: 1 },
  { part: "BACKING_VOCALS", count: 2 },
  { part: "SOUND_ENGINEER", count: 1 },
  { name: "Slides", count: 1 },
];
const body = { title: "Sunday", date, startTime: "10:00", timeZone: "UTC" };

// --- what's accepted
let r = await call(admin, "POST", `/teams/${team.id}/events`, { ...body, parts: [{ part: "KAZOO", count: 1 }] });
check("a part that isn't an instrument or role: refused, by name", r.status === 400 && r.body.message.some((m) => m.includes("KAZOO")), JSON.stringify(r.body));
r = await call(admin, "POST", `/teams/${team.id}/events`, { ...body, parts: [{ part: "DRUMS", name: "Drums", count: 1 }] });
check("a part and a name at once: refused", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "POST", `/teams/${team.id}/events`, { ...body, parts: [{ part: "DRUMS", count: 1 }, { part: "DRUMS", count: 2 }] });
check("the same part twice: refused", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "POST", `/teams/${team.id}/events`, { ...body, parts: [{ name: "Slides", count: 0 }] });
check("none of a part: refused", r.status === 400, String(r.status));
const custom = `ci${stamp}`;
sql(`insert into "CustomInstrument" (id, label, "createdAt", "updatedAt") values ('${custom}', 'Nyckelharpa', now(), now())`);
r = await call(admin, "POST", `/teams/${team.id}/events`, { ...body, parts: [...parts, { part: custom, count: 1 }] });
const event = r.body;
check("an event with its parts: instruments, a role, a name of its own, a custom instrument", r.status === 201 && event.parts.length === 5 && event.parts[3].name === "Slides" && event.parts[4].part === custom, JSON.stringify(event.parts));
r = await call(singer, "POST", `/teams/${team.id}/events`, { ...body, parts });
check("members don't add events", r.status === 403, String(r.status));

// --- coverage
const base = `/teams/${team.id}/events/${event.id}/dates/${date}`;
await call(drummer, "PUT", `${base}/answer`, { answer: "AVAILABLE" });
await call(singer, "PUT", `${base}/answer`, { answer: "IF_NEEDED" });
await call(sound, "PUT", `${base}/answer`, { answer: "UNAVAILABLE" });
r = await call(admin, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`);
const coverage = Object.fromEntries((r.body[0]?.coverage ?? []).map((part) => [part.key, part]));
check("drums: covered by the drummer, available", coverage.DRUMS?.available === 1 && coverage.DRUMS.missing === 0, JSON.stringify(coverage.DRUMS));
check("backing vocals: one if needed, two short", coverage.BACKING_VOCALS?.available === 0 && coverage.BACKING_VOCALS.ifNeeded === 1 && coverage.BACKING_VOCALS.missing === 2, JSON.stringify(coverage.BACKING_VOCALS));
check("sound: its engineer not available, short", coverage.SOUND_ENGINEER?.available === 0 && coverage.SOUND_ENGINEER.missing === 1);
check("a named part: anyone available covers it", coverage["name:slides"]?.available === 1 && coverage["name:slides"].missing === 0, JSON.stringify(coverage["name:slides"]));
check("the custom instrument: no one plays it", coverage[custom]?.missing === 1);
r = await call(singer, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`);
check("members see the parts, not the coverage", r.body[0].coverage === null && r.body[0].parts.length === 5, JSON.stringify(r.body[0].coverage));
r = await call(admin, "GET", `${base}/answers`);
check("who can play: with what each does", r.body.find((m) => m.userId === sound.id)?.techRoles?.includes("SOUND_ENGINEER") && r.body.find((m) => m.userId === drummer.id)?.instruments.includes("DRUMS"), JSON.stringify(r.body.map((m) => [m.displayName, m.instruments, m.techRoles])));

// --- changed
r = await call(admin, "PATCH", `/teams/${team.id}/events/${event.id}`, { parts: [{ part: "DRUMS", count: 2 }] });
check("the parts changed", r.status === 200 && r.body.parts.length === 1 && r.body.parts[0].count === 2, JSON.stringify(r.body.parts));
r = await call(admin, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`);
check("…coverage follows", r.body[0].coverage.length === 1 && r.body[0].coverage[0].missing === 1);
r = await call(admin, "PATCH", `/teams/${team.id}/events/${event.id}`, { title: "Sunday service" });
check("left out: kept", r.body.parts.length === 1);
r = await call(admin, "PATCH", `/teams/${team.id}/events/${event.id}`, { parts: [] });
r = await call(admin, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`);
check("no parts: no coverage", r.body[0].coverage === null && r.body[0].parts.length === 0);

sql(`delete from "CustomInstrument" where id='${custom}'`);
finish();
