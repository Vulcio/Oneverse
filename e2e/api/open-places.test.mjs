// Required parts and open places (issue #528). A part an event needs can be
// required - a date whose line-up lacks it says it's missing - and opened to
// teams: the event's own team, or groups of its organisation, whose members
// put themselves on it while places are left, and may give it up again. The
// team's admins are told. Host and Speaker are never open: a role or the
// admins decide them.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Open places admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const planner = await user("Open places planner");
const singer = await user("Open places singer");
const youth = await user("Open places youth");
const stranger = await user("Open places stranger");
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);

await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
try {
  const org = (await call(planner, "POST", "/organizations", { name: `Open places church ${stamp}` })).body;
  const music = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Music ${stamp}`, usesSongverse: true })).body;
  const youthGroup = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Youth ${stamp}` })).body;
  const elsewhere = (await call(stranger, "POST", "/teams", { name: `Elsewhere ${stamp}` })).body;
  const join = (who, teamId, n) => {
    sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('omop${n}${stamp}', '${org.id}', '${who.id}', 'MEMBER', now(), now()) on conflict do nothing`);
    sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmop${n}${stamp}', '${teamId}', '${who.id}', 'MEMBER', now(), now())`);
  };
  join(singer, music.id, 1);
  join(youth, youthGroup.id, 2);

  // --- what a part may say
  const date = plus(3);
  const make = (parts) => call(planner, "POST", `/teams/${music.id}/events`, { title: "Sunday", date, startTime: "10:00", timeZone: "UTC", parts });
  let r = await make([{ part: "HOST", count: 1, openTo: [music.id] }]);
  check("Host can come from a team, like any position (issue #559)", r.status === 201 && r.body.parts[0].openTo.join() === music.id, JSON.stringify(r.body));
  await call(planner, "DELETE", `/teams/${music.id}/events/${r.body.id}`);
  r = await make([{ part: "MUSIC_LEADER", count: 1, openTo: [elsewhere.id] }]);
  check("open only to the team or groups of its organisation", r.status === 400 && r.body.message.join().includes(elsewhere.id), JSON.stringify(r.body));
  r = await make([
    { part: "HOST", count: 1, required: true },
    { part: "MUSIC_LEADER", count: 1, required: true, openTo: [music.id, youthGroup.id] },
    { part: "MEDIA_OPERATOR", count: 2, openTo: [youthGroup.id] },
  ]);
  check("required parts and open places kept", r.status === 201 && r.body.parts[1].required === true && r.body.parts[1].openTo.join() === `${music.id},${youthGroup.id}` && r.body.parts[2].required === undefined, JSON.stringify(r.body.parts));
  const event = r.body;

  // An event type keeps them too.
  r = await call(planner, "POST", `/teams/${music.id}/event-types`, { name: `Service ${stamp}`, parts: [{ part: "MUSIC_LEADER", count: 1, required: true, openTo: [music.id] }] });
  check("an event type keeps them", r.status === 201 && r.body.parts[0].required === true && r.body.parts[0].openTo[0] === music.id, JSON.stringify(r.body));

  const dateOf = async (who) => (await call(who, "GET", `/teams/${music.id}/event-dates?from=${date}&to=${date}`)).body.find((one) => one.eventId === event.id);
  let seen = await dateOf(singer);
  check("the date says what's missing", seen.missing.join() === "HOST,MUSIC_LEADER", JSON.stringify(seen.missing));
  check("…and what a member may take", seen.volunteerOptions.join() === "MUSIC_LEADER", JSON.stringify(seen.volunteerOptions));

  // --- My calendar's open places
  let open = (await call(youth, "GET", `/users/me/open-places?from=${date}&to=${date}`)).body;
  check("another group's member: the places open to their group", open.map((one) => one.partKey).join() === "MUSIC_LEADER,MEDIA_OPERATOR" && open.every((one) => one.guest && one.teamId === music.id), JSON.stringify(open));
  open = (await call(stranger, "GET", `/users/me/open-places?from=${date}&to=${date}`)).body;
  check("someone outside: none", open.length === 0, JSON.stringify(open));

  // --- taking one
  const take = (who, part) => call(who, "POST", "/users/me/open-places", { teamId: music.id, eventId: event.id, date, part });
  r = await take(singer, "HOST");
  check("not a place that isn't open", r.status === 400, JSON.stringify(r.body));
  r = await take(singer, "MEDIA_OPERATOR");
  check("not one open to another group", r.status === 400, JSON.stringify(r.body));
  r = await take(stranger, "MUSIC_LEADER");
  check("not someone outside", r.status === 400, JSON.stringify(r.body));
  r = await take(singer, "MUSIC_LEADER");
  check("a member takes the music leader's place: accepted", r.status === 201 && r.body.status === "ACCEPTED" && r.body.guest === null, JSON.stringify(r.body));
  const singerPlace = r.body.id;
  r = await take(youth, "MUSIC_LEADER");
  check("…no place left for another", r.status === 409, JSON.stringify(r.body));
  const told = await notes(planner, "VOLUNTEERED");
  check("the team's admins are told", told.length === 1 && told[0].data.by === "Open places singer", JSON.stringify(told));
  seen = await dateOf(singer);
  check("…no longer missing, and they may give it up", seen.missing.join() === "HOST" && seen.lineup.find((one) => one.id === singerPlace)?.volunteered === true && seen.myAnswer.answer === "AVAILABLE", JSON.stringify(seen));

  r = await take(youth, "MEDIA_OPERATOR");
  check("another group's member takes the operator's place: a guest of the date", r.status === 201 && r.body.guest === "account", JSON.stringify(r.body));
  const youthPlace = r.body.id;
  const mine = (await call(youth, "GET", `/users/me/event-dates?from=${date}&to=${date}`)).body.find((one) => one.eventId === event.id);
  check("…on their calendar, with the date's set", !!mine && mine.guest === true && !!mine.setlistId, JSON.stringify(mine));
  const set = await call(youth, "GET", `/setlists/${mine.setlistId}`);
  check("…which they see", set.status === 200, String(set.status));
  open = (await call(youth, "GET", `/users/me/open-places?from=${date}&to=${date}`)).body;
  check("…none left for them: they're on the operator's part, the music leader's is taken", open.length === 0, JSON.stringify(open));

  // --- giving it up
  r = await call(youth, "DELETE", `/users/me/open-places/${singerPlace}`);
  check("not someone else's place", r.status === 404, String(r.status));
  r = await call(youth, "DELETE", `/users/me/open-places/${youthPlace}`);
  check("one gives up a place one took", r.status === 204, String(r.status));
  check("…the admins are told", (await notes(planner, "VOLUNTEER_WITHDREW")).length === 1);
  check("…and no longer sees the set", (await call(youth, "GET", `/setlists/${mine.setlistId}`)).status !== 200);
  const placed = (await call(planner, "POST", `/teams/${music.id}/events/${event.id}/dates/${date}/lineup`, { userId: singer.id, part: "MEDIA_OPERATOR" })).body;
  r = await call(singer, "DELETE", `/users/me/open-places/${placed.id}`);
  check("a place the admins gave: not given up this way", r.status === 404, String(r.status));

  // --- a team that has its members' offers confirmed (issue #559)
  r = await call(planner, "PATCH", `/teams/${youthGroup.id}/group`, { confirmOffers: true });
  check("a team has its members' offers confirmed", r.status === 200, JSON.stringify(r.body));
  check("…its organisation shows it", (await call(planner, "GET", `/organizations/${org.id}`)).body.teams.find((one) => one.id === youthGroup.id)?.confirmOffers === true);
  r = await take(youth, "MEDIA_OPERATOR");
  check("an offer through it waits for an admin", r.status === 201 && r.body.status === "PENDING", JSON.stringify(r.body));
  const offer = r.body.id;
  check("…the admins are asked to confirm it", (await notes(planner, "OFFER_TO_CONFIRM")).length === 1);
  r = await call(youth, "PUT", `/teams/${music.id}/events/${event.id}/dates/${date}/lineup/${offer}/response`, { status: "ACCEPTED" });
  check("…not by the one who offered", r.status === 403, String(r.status));
  r = await call(singer, "POST", `/teams/${music.id}/events/${event.id}/dates/${date}/lineup/${offer}/confirm`);
  check("…nor by a member", r.status === 403, String(r.status));
  r = await call(planner, "POST", `/teams/${music.id}/events/${event.id}/dates/${date}/lineup/${offer}/confirm`);
  check("an admin confirms it", r.status === 201 && r.body.status === "ACCEPTED", JSON.stringify(r.body));
  check("…and they're told", (await notes(youth, "OFFER_CONFIRMED")).length === 1);
  r = await call(planner, "POST", `/teams/${music.id}/events/${event.id}/dates/${date}/lineup/${offer}/confirm`);
  check("…once", r.status === 404, String(r.status));

  await call(admin, "DELETE", `/admin/organizations/${org.id}`);
} finally {
  await call(admin, "DELETE", "/admin/organizations/settings");
}
await finish();
