// Swaps (issue #235, phase 7): someone on a line-up asks for a replacement
// (with a note); the members who play the part - not on it already, not
// unavailable or away that date - are offered it; the first to take it
// gets the place (accepted, available that date), the one replaced and the
// team's admins are told. Cancelled, it's no longer offered.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("swap admin");
const alex = await user("swap alex");
const bea = await user("swap bea");
const cyd = await user("swap cyd");
const dan = await user("swap dan");
const eve = await user("swap eve");
for (const who of [alex, bea, cyd, eve]) sql(`update "User" set instruments='{DRUMS}' where id='${who.id}'`);
sql(`update "User" set instruments='{PIANO}' where id='${dan.id}'`);
const team = (await call(admin, "POST", "/teams", { name: `Swaps ${stamp}` })).body;
[alex, bea, cyd, dan, eve].forEach((who, n) => sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tms${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`));
const date = plus(3);
const event = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Sunday", date, startTime: "10:00", timeZone: "UTC", parts: [{ part: "DRUMS", count: 1 }] })).body;
const base = `/teams/${team.id}/events/${event.id}/dates/${date}`;
await call(cyd, "PUT", `${base}/answer`, { answer: "UNAVAILABLE" });
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);
const lineupAs = async (who) => (await call(who, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`)).body[0].lineup;

let place = (await call(admin, "POST", `${base}/lineup`, { userId: alex.id, part: "DRUMS" })).body;
await call(alex, "PUT", `${base}/lineup/${place.id}/response`, { status: "ACCEPTED" });

let r = await call(bea, "POST", `${base}/lineup/${place.id}/take`);
check("a place not offered can't be taken", r.status === 409, String(r.status));
r = await call(bea, "POST", `${base}/lineup/${place.id}/swap`, {});
check("only the person on it asks for a replacement", r.status === 404, String(r.status));

// --- asking
r = await call(alex, "POST", `${base}/lineup/${place.id}/swap`, { note: "Sick, sorry" });
check("a replacement asked for: those who play it offered", r.status === 201 && r.body.notified === 2, JSON.stringify(r.body));
const offered = (await notes(bea, "SWAP_OFFERED"))[0];
check("…told who, what, when", offered?.data.by === "swap alex" && offered.data.part === "DRUMS" && offered.data.date === date, JSON.stringify(offered));
check("…not the one unavailable, not one who doesn't play it", (await notes(cyd, "SWAP_OFFERED")).length === 0 && (await notes(dan, "SWAP_OFFERED")).length === 0);
let seen = (await lineupAs(bea))[0];
check("a drummer sees it offered, with the note, and can take it", seen.swap?.note === "Sick, sorry" && seen.canTake === true, JSON.stringify(seen));
check("…a pianist can't", (await lineupAs(dan))[0].canTake === false);
check("…the one asking sees their request", (await lineupAs(alex))[0].mine && (await lineupAs(alex))[0].swap !== null);
r = await call(dan, "POST", `${base}/lineup/${place.id}/take`);
check("one who doesn't play it: refused", r.status === 400, String(r.status));
r = await call(alex, "POST", `${base}/lineup/${place.id}/take`);
check("one's own place: refused", r.status === 400, String(r.status));

// --- cancelled
r = await call(alex, "DELETE", `${base}/lineup/${place.id}/swap`);
check("cancelled: no longer offered", r.status === 204 && (await lineupAs(bea))[0].swap === null && (await lineupAs(bea))[0].canTake === false);
r = await call(bea, "POST", `${base}/lineup/${place.id}/take`);
check("…so it can't be taken", r.status === 409, String(r.status));

// --- taken, first one wins
await call(alex, "POST", `${base}/lineup/${place.id}/swap`, {});
const [first, second] = await Promise.all([call(bea, "POST", `${base}/lineup/${place.id}/take`), call(eve, "POST", `${base}/lineup/${place.id}/take`)]);
const winner = first.status === 201 ? { who: bea, r: first } : { who: eve, r: second };
check("two take it at once: one gets it, the other is told it's gone", [first.status, second.status].sort().join() === "201,409", `${first.status} ${second.status}`);
const lineup = await lineupAs(admin);
check("the place is theirs, accepted; the one asking is off", lineup.length === 1 && lineup[0].userId === winner.who.id && lineup[0].status === "ACCEPTED" && lineup[0].swap === null, JSON.stringify(lineup));
const taken = (await notes(alex, "SWAP_TAKEN"))[0];
check("the one replaced is told who took it", taken?.data.by === (winner.who === bea ? "swap bea" : "swap eve") && taken.data.part === "DRUMS", JSON.stringify(taken));
check("…and the team's admins", (await notes(admin, "SWAP_TAKEN")).length === 1);
check("taking it says they're available", (await call(winner.who, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`)).body[0].myAnswer.answer === "AVAILABLE");
const sets = async (who) => (await call(who, "GET", "/setlists")).body.find((set) => set.fromEvent && set.name === "Sunday");
check("signed up: the one who took it, not the one replaced", (await sets(winner.who))?.signedUp === true && (await sets(alex))?.signedUp === false);

finish();
