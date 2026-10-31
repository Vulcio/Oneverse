// Leaving a team (issue #340): one step however it happens - removed by an
// admin, leaving on one's own - takes one's places from today on in the
// team's line-ups and one's answers for those dates; the past stays.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("leave admin");
const ana = await user("leave ana");
const ben = await user("leave ben");
const team = (await call(admin, "POST", "/teams", { name: `Leave ${stamp}` })).body;
[ana, ben].forEach((who, n) => sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tml${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`));
const date = plus(5);
const event = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Sunday", date, startTime: "10:00", timeZone: "UTC", parts: [{ part: "DRUMS", count: 2 }] })).body;
const base = `/teams/${team.id}/events/${event.id}/dates/${date}`;
for (const who of [ana, ben]) {
  await call(who, "PUT", `${base}/answer`, { answer: "AVAILABLE" });
  await call(admin, "POST", `${base}/lineup`, { userId: who.id, part: "DRUMS" });
}
// A past date of theirs: kept as a record.
const past = plus(-7);
for (const who of [ana, ben]) {
  sql(`insert into "TeamEventAssignment" (id, "eventId", date, "partKey", "userId", status) values ('pa${who.id.slice(-6)}${stamp}', '${event.id}', '${past}', 'DRUMS', '${who.id}', 'ACCEPTED')`);
}
const count = (table, who) => Number(sql(`select count(*) from "${table}" where "userId"='${who.id}' and "eventId"='${event.id}'`));
check("both on the line-up, with answers", count("TeamEventAssignment", ana) === 2 && count("TeamEventAnswer", ana) === 1 && count("TeamEventAssignment", ben) === 2);

let r = await call(admin, "DELETE", `/teams/${team.id}/members/${ana.id}`);
check("removed by an admin: their coming places and answers go", r.status === 204 && count("TeamEventAssignment", ana) === 1 && count("TeamEventAnswer", ana) === 0, `${r.status} ${count("TeamEventAssignment", ana)}`);
check("…their past one stays", sql(`select date::text from "TeamEventAssignment" where "userId"='${ana.id}'`) === past);
const lineup = (await call(admin, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`)).body[0].lineup;
check("…and the line-up no longer counts on them", lineup.length === 1 && lineup[0].userId === ben.id, JSON.stringify(lineup.map((place) => place.userId)));

r = await call(ben, "POST", `/teams/${team.id}/leave`);
check("leaving on one's own: the same", r.status === 204 && count("TeamEventAssignment", ben) === 1 && count("TeamEventAnswer", ben) === 0, `${r.status}`);

r = await call(admin, "DELETE", `/teams/${team.id}/members/${admin.id}`);
check("the last admin can't leave", r.status === 409, String(r.status));

finish();
