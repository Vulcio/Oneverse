// The calendar reworked (issue #549). Groups say which roles they fill -
// Worship fills Music - and a place open to a group is open to the groups
// under it (Tech > Media). A date of a series can be changed on its own.
// On a date, its music lead (or the team's admins) asks for instruments:
// they join the date's parts, open to whoever its Music is open to, and are
// taken as open places. A team's event moves to its organisation once one
// of the organisation's admins accepts: its dates, line-ups and sets stay.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Rework admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const planner = await user("Rework planner");
const coAdmin = await user("Rework co-admin");
const lead = await user("Rework lead");
const drummer = await user("Rework drummer");
const media = await user("Rework media");
const stranger = await user("Rework stranger");
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);

await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
try {
  const org = (await call(planner, "POST", "/organizations", { name: `Rework church ${stamp}` })).body;
  const sunday = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Sunday ${stamp}`, usesSongverse: true })).body;
  const worship = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Worship ${stamp}`, usesSongverse: true })).body;
  const tech = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Tech ${stamp}` })).body;
  const mediaGroup = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Media ${stamp}`, parentId: tech.id })).body;
  let n = 0;
  const join = (who, teamId, role = "MEMBER") => {
    n++;
    sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('omrw${n}${stamp}', '${org.id}', '${who.id}', '${role}', now(), now()) on conflict do nothing`);
    if (teamId) sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmrw${n}${stamp}', '${teamId}', '${who.id}', 'MEMBER', now(), now())`);
  };
  join(coAdmin, null, "ADMIN");
  join(lead, worship.id);
  join(drummer, worship.id);
  join(media, mediaGroup.id);

  // --- the roles a group fills
  let r = await call(planner, "PATCH", `/teams/${worship.id}/group`, { fills: ["HOST"] });
  check("Host isn't a role a group fills: a role gives it to people", r.status === 400, JSON.stringify(r.body));
  r = await call(planner, "PATCH", `/teams/${worship.id}/group`, { fills: ["MUSIC_LEADER"] });
  check("Worship fills Music", r.status === 200, JSON.stringify(r.body));
  r = await call(planner, "PATCH", `/teams/${tech.id}/group`, { fills: ["MEDIA_OPERATOR", "SOUND_ENGINEER", "LIGHTS"] });
  check("Tech fills Media, Audio and Lights", r.status === 200, JSON.stringify(r.body));
  const detail = (await call(planner, "GET", `/organizations/${org.id}`)).body;
  check("the organisation's groups say what they fill", detail.teams.find((one) => one.id === worship.id)?.fills.join() === "MUSIC_LEADER" && detail.teams.find((one) => one.id === tech.id)?.fills.length === 3, JSON.stringify(detail.teams));

  // --- a weekly service asking for roles, open to the groups that fill them
  const date = plus(3);
  r = await call(planner, "POST", `/teams/${sunday.id}/events`, {
    title: "Sunday service",
    date,
    startTime: "10:00",
    timeZone: "UTC",
    repeat: { everyWeeks: 1 },
    parts: [
      { part: "MUSIC_LEADER", count: 1, required: true, openTo: [worship.id] },
      { part: "MEDIA_OPERATOR", count: 1, openTo: [tech.id] },
      { part: "LIGHTS", count: 1 },
    ],
  });
  check("an event asks for Music, Media and Lights", r.status === 201, JSON.stringify(r.body));
  const event = r.body;

  let open = (await call(media, "GET", `/users/me/open-places?from=${date}&to=${date}`)).body;
  check("a place open to Tech is open to Media, under it", open.some((one) => one.partKey === "MEDIA_OPERATOR" && one.eventId === event.id), JSON.stringify(open));
  r = await call(media, "POST", "/users/me/open-places", { teamId: sunday.id, eventId: event.id, date, part: "MEDIA_OPERATOR" });
  check("…and Media's member takes it", r.status === 201, JSON.stringify(r.body));
  r = await call(lead, "POST", "/users/me/open-places", { teamId: sunday.id, eventId: event.id, date, part: "MUSIC_LEADER" });
  check("a Worship member takes Music: the date's music lead", r.status === 201, JSON.stringify(r.body));

  // --- one date changed on its own
  r = await call(planner, "PATCH", `/teams/${sunday.id}/events/${event.id}/dates/${date}`, { title: "Easter service", startTime: "09:30" });
  check("a date of the series changed on its own", r.status === 200 && r.body.title === "Easter service" && r.body.startTime === "09:30" && r.body.changed === true, JSON.stringify(r.body));
  r = await call(planner, "PATCH", `/teams/${sunday.id}/events/${event.id}/dates/${date}`, { title: null, startTime: null });
  check("…and back to the series", r.status === 200 && r.body.title === "Sunday service" && r.body.startTime === "10:00" && r.body.changed === false, JSON.stringify(r.body));

  // --- the instruments, asked for from the date
  const asks = (who, parts, on = date) => call(who, "PUT", `/teams/${sunday.id}/events/${event.id}/dates/${on}/asks`, { parts });
  r = await asks(drummer, [{ part: "DRUMS", count: 1 }]);
  check("not someone who isn't the date's music lead", r.status === 403, JSON.stringify(r.body));
  r = await asks(stranger, [{ part: "DRUMS", count: 1 }]);
  check("not someone outside", r.status === 403, JSON.stringify(r.body));
  r = await asks(lead, [{ part: "HOST", count: 1 }]);
  check("not a Host: the event asks for that", r.status === 400, JSON.stringify(r.body));
  r = await asks(lead, [{ part: "DRUMS", count: 1 }, { part: "BASS_GUITAR", count: 1 }]);
  check("the music lead asks for drums and bass, open to Worship", r.status === 200 && r.body.parts.map((one) => one.part).join() === "DRUMS,BASS_GUITAR" && r.body.parts.every((one) => one.openTo.join() === worship.id), JSON.stringify(r.body));
  r = await asks(lead, [{ part: "DRUMS", count: 1 }], plus(10));
  check("only on the date they lead", r.status === 403, JSON.stringify(r.body));

  const dateOf = async (who, on = date) => (await call(who, "GET", `/teams/${sunday.id}/event-dates?from=${on}&to=${on}`)).body.find((one) => one.eventId === event.id);
  let seen = await dateOf(planner);
  check("the date's parts: the event's, then its asks", seen.parts.map((one) => one.part).join() === "MUSIC_LEADER,MEDIA_OPERATOR,LIGHTS,DRUMS,BASS_GUITAR" && seen.asks.length === 2, JSON.stringify(seen.parts));
  check("…the next date has none of them", (await dateOf(planner, plus(10))).parts.length === 3);
  open = (await call(drummer, "GET", `/users/me/open-places?from=${date}&to=${date}`)).body;
  check("a Worship member sees the drums and bass places", ["DRUMS", "BASS_GUITAR"].every((key) => open.some((one) => one.partKey === key)), JSON.stringify(open));
  r = await call(drummer, "POST", "/users/me/open-places", { teamId: sunday.id, eventId: event.id, date, part: "DRUMS" });
  check("…and takes the drums", r.status === 201, JSON.stringify(r.body));

  // The set's page: its music lead sees what's asked, and may change it.
  const { setlistId } = (await call(planner, "POST", `/teams/${sunday.id}/events/${event.id}/dates/${date}/set`)).body;
  r = await call(lead, "GET", `/setlists/${setlistId}/availability`);
  check("on the set, the music lead sees the asks and may change them", r.status === 200 && r.body.asks.length === 2 && r.body.canAsk === true, JSON.stringify(r.body));
  r = await asks(planner, [{ part: "BASS_GUITAR", count: 1 }]);
  check("a team admin asks too: drums no longer asked", r.status === 200 && r.body.parts.length === 1, JSON.stringify(r.body));
  seen = await dateOf(planner);
  check("…its place goes with it", !seen.lineup.some((one) => one.partKey === "DRUMS"), JSON.stringify(seen.lineup));

  // --- moving an event to the organisation
  r = await call(drummer, "POST", `/teams/${sunday.id}/events/${event.id}/transfer`);
  check("only the team's admins ask", r.status === 403, JSON.stringify(r.body));
  r = await call(planner, "POST", `/teams/${sunday.id}/events/${event.id}/transfer`);
  check("the team's admin asks to move the series", r.status === 201 && !!r.body.transferRequestedAt, JSON.stringify(r.body));
  check("the organisation's other admins are told", (await notes(coAdmin, "EVENT_TRANSFER_REQUESTED")).some((one) => one.data.event === "Sunday service"));
  r = await call(drummer, "GET", `/organizations/${org.id}/event-transfers`);
  check("a member doesn't see the requests", r.status === 403, JSON.stringify(r.body));
  r = await call(coAdmin, "GET", `/organizations/${org.id}/event-transfers`);
  check("its admins do", r.status === 200 && r.body.length === 1 && r.body[0].teamEventId === event.id && r.body[0].repeat?.everyWeeks === 1, JSON.stringify(r.body));

  r = await call(planner, "DELETE", `/teams/${sunday.id}/events/${event.id}/transfer`);
  check("the request taken back", r.status === 200 && r.body.transferRequestedAt === null, JSON.stringify(r.body));
  check("…nothing waits any more", (await call(coAdmin, "GET", `/organizations/${org.id}/event-transfers`)).body.length === 0);
  await call(planner, "POST", `/teams/${sunday.id}/events/${event.id}/transfer`);

  r = await call(coAdmin, "POST", `/organizations/${org.id}/event-transfers/${event.id}/accept`);
  check("an organisation admin accepts: an organisation event, hosted by who asked", r.status === 201 && r.body.title === "Sunday service" && r.body.repeat?.everyWeeks === 1 && r.body.host?.id === planner.id && r.body.needs.length === 1 && r.body.needs[0].teamEventId === event.id, JSON.stringify(r.body));
  check("the one who asked is told", (await notes(planner, "EVENT_TRANSFER_ACCEPTED")).length === 1);
  seen = await dateOf(planner);
  check("the team's dates, line-up and set are kept", seen.setlistId === setlistId && seen.lineup.some((one) => one.partKey === "MUSIC_LEADER") && seen.lineup.some((one) => one.partKey === "MEDIA_OPERATOR"), JSON.stringify(seen));
  r = await call(planner, "POST", `/teams/${sunday.id}/events/${event.id}/transfer`);
  check("it's the organisation's: not asked again", r.status === 400, JSON.stringify(r.body));
  const orgDates = (await call(coAdmin, "GET", `/organizations/${org.id}/event-dates?from=${date}&to=${date}`)).body;
  check("on the organisation's calendar", orgDates.some((one) => one.title === "Sunday service" && one.groups.some((group) => group.teamId === sunday.id)), JSON.stringify(orgDates));

  // Declined: it stays the team's.
  const meeting = (await call(planner, "POST", `/teams/${sunday.id}/events`, { title: "Team meeting", date: plus(5), startTime: "19:00", timeZone: "UTC" })).body;
  await call(planner, "POST", `/teams/${sunday.id}/events/${meeting.id}/transfer`);
  r = await call(planner, "POST", `/organizations/${org.id}/event-transfers/${meeting.id}/decline`);
  check("an admin who asked as the team's may decline as the organisation's", r.status === 204, JSON.stringify(r.body));
  const kept = (await call(planner, "GET", `/teams/${sunday.id}/events`)).body.find((one) => one.id === meeting.id);
  check("declined: the team's still, not waiting", kept && !kept.organizationEventId && kept.transferRequestedAt === null, JSON.stringify(kept));
  r = await call(coAdmin, "POST", `/organizations/${org.id}/event-transfers/${meeting.id}/accept`);
  check("nothing left to accept", r.status === 404, JSON.stringify(r.body));
} finally {
  await call(admin, "DELETE", "/admin/organizations/settings");
}
await finish();
