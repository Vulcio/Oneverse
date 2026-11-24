// Who can play, on the set's page (issue #520): answering Available or If
// needed also says which parts one would like to play - the date's parts,
// or one's own instruments and roles when it lists none. On a team's own
// event, its admins pick the host as they like (a role only limits an
// organisation's events, see organization-hosts). Those who edit the
// set made for the date see everyone's answers and wishes there, the
// admins' notes only for admins. The host and the music leader on the
// date's line-up edit its set (not delete it or give it away).
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("set availability admin");
const leader = await user("set availability leader");
const drummer = await user("set availability drummer");
const quiet = await user("set availability quiet");
const host = await user("set availability host");
sql(`update "User" set instruments='{DRUMS,PIANO}' where id='${drummer.id}'`);
sql(`update "User" set "techRoles"='{MUSIC_LEADER}', instruments='{LEAD_VOCALS}' where id='${leader.id}'`);
const team = (await call(admin, "POST", "/teams", { name: `Set availability ${stamp}` })).body;
[leader, drummer, quiet, host].forEach((who, n) =>
  sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmsa${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`),
);

const date = plus(4);
const event = (await call(admin, "POST", `/teams/${team.id}/events`, {
  title: "Sunday",
  date,
  startTime: "10:00",
  timeZone: "UTC",
  parts: [
    { part: "MUSIC_LEADER", count: 1 },
    { part: "HOST", count: 1 },
    { part: "DRUMS", count: 1 },
  ],
})).body;
const base = `/teams/${team.id}/events/${event.id}/dates/${date}`;
// A team's own event (issue #520): its admins name whoever they like as Host, and anyone may wish to.
let r0 = await call(leader, "PUT", `${base}/answer`, { answer: "AVAILABLE", wishes: ["HOST"] });
check("hosting: anyone may wish for it", r0.status === 200 && r0.body.wishes.join() === "HOST", JSON.stringify(r0.body));
const leaderDate = (await call(leader, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`)).body.find((one) => one.eventId === event.id);
check("…among what one may wish for", leaderDate.wishOptions.some((part) => part.part === "HOST"), JSON.stringify(leaderDate.wishOptions));
r0 = await call(admin, "POST", `${base}/lineup`, { guestName: "Visitor", part: "HOST" });
check("…never someone without an account", r0.status === 400, JSON.stringify(r0.body));
r0 = await call(admin, "POST", `${base}/lineup`, { userId: quiet.id, part: "HOST" });
check("…but any member the admins pick", r0.status === 201, JSON.stringify(r0.body));
await call(admin, "DELETE", `${base}/lineup/${r0.body.id}`);

// --- wishes
let r = await call(drummer, "PUT", `${base}/answer`, { answer: "AVAILABLE", wishes: ["DRUMS", "MUSIC_LEADER"] });
check("Available, with the parts one would like", r.status === 200 && r.body.wishes.join() === "DRUMS,MUSIC_LEADER", JSON.stringify(r.body));
r = await call(drummer, "PUT", `${base}/answer`, { answer: "AVAILABLE", wishes: ["PIANO"] });
check("a part the date doesn't list: refused", r.status === 400 && r.body.message.join().includes("PIANO"), JSON.stringify(r.body));
r = await call(drummer, "PUT", `${base}/answer`, { answer: "IF_NEEDED", note: "Late" });
check("wishes left out: kept", r.body.wishes.join() === "DRUMS,MUSIC_LEADER", JSON.stringify(r.body));
await call(leader, "PUT", `${base}/answer`, { answer: "AVAILABLE", wishes: ["MUSIC_LEADER"], note: "Can lead" });
r = await call(host, "PUT", `${base}/answer`, { answer: "AVAILABLE", wishes: ["HOST"] });
r = await call(host, "PUT", `${base}/answer`, { answer: "UNAVAILABLE" });
check("Not available: no wishes", r.body.wishes.length === 0, JSON.stringify(r.body));
const mine = (await call(drummer, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`)).body.find((one) => one.eventId === event.id);
check("the calendar: one's wishes, and what one may wish for", mine.myAnswer.wishes.join() === "DRUMS,MUSIC_LEADER" && mine.wishOptions.map((part) => part.part).join() === "MUSIC_LEADER,HOST,DRUMS", JSON.stringify(mine));

// Without parts: one's own instruments and roles.
const rehearsal = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Practice", date: plus(5), startTime: "19:00", timeZone: "UTC" })).body;
const loose = `/teams/${team.id}/events/${rehearsal.id}/dates/${plus(5)}`;
r = await call(drummer, "PUT", `${loose}/answer`, { answer: "AVAILABLE", wishes: ["PIANO"] });
check("no parts: what one plays", r.status === 200 && r.body.wishes.join() === "PIANO", JSON.stringify(r.body));
r = await call(drummer, "PUT", `${loose}/answer`, { answer: "AVAILABLE", wishes: ["HOST", "PIANO"] });
check("…and hosting", r.status === 200 && r.body.wishes.join() === "HOST,PIANO", JSON.stringify(r.body));
r = await call(drummer, "PUT", `${loose}/answer`, { answer: "AVAILABLE", wishes: ["BASS_GUITAR"] });
check("…not what one doesn't", r.status === 400, JSON.stringify(r.body));
const mineThere = (await call(drummer, "GET", `/users/me/event-dates?from=${plus(5)}&to=${plus(5)}`)).body.find((one) => one.eventId === rehearsal.id);
check("My calendar: what one may wish for", mineThere.wishOptions.map((part) => part.part).join() === "HOST,SPEAKER,DRUMS,PIANO" && mineThere.myAnswer.wishes.join() === "HOST,PIANO", JSON.stringify(mineThere));
r = await call(admin, "GET", `${base}/answers`);
check("the admins' answers: everyone's wishes", r.body.find((one) => one.userId === drummer.id).wishes.join() === "DRUMS,MUSIC_LEADER", JSON.stringify(r.body));

// --- the set's page
const { setlistId } = (await call(admin, "POST", `${base}/set`)).body;
r = await call(admin, "GET", `/setlists/${setlistId}/availability`);
const of = (who) => r.body.members.find((one) => one.userId === who.id);
check(
  "the set: everyone's answer and wishes, notes for the admins",
  r.status === 200 && r.body.date === date && r.body.title === "Sunday" && of(drummer).answer === "IF_NEEDED" && of(drummer).note === "Late" && of(leader).wishes.join() === "MUSIC_LEADER" && of(host).answer === "UNAVAILABLE" && of(quiet).answer === null && r.body.leaders.length === 0,
  JSON.stringify(r.body),
);
r = await call(leader, "GET", `/setlists/${setlistId}/availability`);
check("members who don't edit the set: not shown", r.status === 403, String(r.status));
const byHand = (await call(admin, "POST", "/setlists", { name: `By hand ${stamp}`, teamId: team.id })).body;
r = await call(admin, "GET", `/setlists/${byHand.id}/availability`);
check("a set not made for a date: nothing", r.status === 404, String(r.status));
r = await call(leader, "POST", `/setlists/${setlistId}/items`, { text: { title: "Welcome", body: "Hello" } });
check("a member doesn't edit the set", r.status === 403, String(r.status));

// --- the music leader and the host on the line-up
const place = (await call(admin, "POST", `${base}/lineup`, { userId: leader.id, part: "MUSIC_LEADER" })).body;
await call(admin, "POST", `${base}/lineup`, { userId: drummer.id, part: "HOST" });
let set = (await call(leader, "GET", `/setlists/${setlistId}`)).body;
check("the music leader on the line-up edits the set, without deleting it or giving it away", set.canEdit === true && set.canManage === false, JSON.stringify({ canEdit: set.canEdit, canManage: set.canManage }));
check("…the set list says so too", (await call(leader, "GET", "/setlists")).body.find((one) => one.id === setlistId)?.canEdit === true);
r = await call(leader, "POST", `/setlists/${setlistId}/items`, { text: { title: "Welcome", body: "Hello" } });
check("…adds to it", r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
r = await call(leader, "GET", `/setlists/${setlistId}/availability`);
check("…sees who can play, not the notes", r.status === 200 && r.body.members.every((one) => one.note === null) && r.body.leaders.map((one) => one.partKey).join() === "MUSIC_LEADER,HOST", JSON.stringify(r.body));
r = await call(leader, "DELETE", `/setlists/${setlistId}`);
check("…doesn't delete it", r.status === 403, String(r.status));
r = await call(leader, "PATCH", `/setlists/${setlistId}`, { teamId: null });
check("…or give it away", r.status === 403, String(r.status));
set = (await call(drummer, "GET", `/setlists/${setlistId}`)).body;
check("the host on the line-up edits it too", set.canEdit === true && set.canManage === false);
await call(leader, "PUT", `${base}/lineup/${place.id}/response`, { status: "DECLINED" });
set = (await call(leader, "GET", `/setlists/${setlistId}`)).body;
check("declining: no longer edits it", set.canEdit === false, JSON.stringify({ canEdit: set.canEdit }));

// --- the event marks who leads the set (issue #559): here the drums, not the host
r = await call(admin, "PATCH", `/teams/${team.id}/events/${event.id}`, {
  parts: [
    { part: "MUSIC_LEADER", count: 1 },
    { part: "HOST", count: 1, leadsSet: false },
    { part: "DRUMS", count: 1, leadsSet: true },
  ],
});
check("an event marks the parts that lead its set", r.status === 200, JSON.stringify(r.body));
await call(admin, "POST", `${base}/lineup`, { userId: quiet.id, part: "DRUMS" });
set = (await call(drummer, "GET", `/setlists/${setlistId}`)).body;
check("…the host no longer edits it", set.canEdit === false, JSON.stringify({ canEdit: set.canEdit }));
set = (await call(quiet, "GET", `/setlists/${setlistId}`)).body;
check("…the drummer does", set.canEdit === true && set.canManage === false, JSON.stringify({ canEdit: set.canEdit }));
check("…the set list says so too", (await call(quiet, "GET", "/setlists")).body.find((one) => one.id === setlistId)?.canEdit === true);
r = await call(admin, "GET", `/setlists/${setlistId}/availability`);
check("…and its leading parts are those", r.body.leadingParts.join() === "MUSIC_LEADER,DRUMS" && r.body.leaders.map((one) => one.userId).join() === quiet.id, JSON.stringify({ parts: r.body.leadingParts, leaders: r.body.leaders }));

await finish();
