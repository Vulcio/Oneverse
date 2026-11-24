// Who may speak (issues #523, #559). The admins put whoever they like on
// Speaker: a member, one of their People, or a guest without an account, by
// name. No role gives it: an event takes its Speaker from a team (one of the
// organisation's groups, "Preaching"), whose members may be put on it
// without being in the team that has the date.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Speakers admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const planner = await user("Speakers planner");
const preacher = await user("Speakers preacher");
const visitor = await user("Speakers visitor");
const musician = await user("Speakers musician");
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
try {
  const org = (await call(planner, "POST", "/organizations", { name: `Speakers church ${stamp}` })).body;
  const music = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Music ${stamp}`, usesSongverse: true })).body;
  const preaching = (await call(planner, "POST", `/organizations/${org.id}/groups`, { name: `Preaching ${stamp}` })).body;
  const join = (who, teamId, n) => {
    sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('oms${n}${stamp}', '${org.id}', '${who.id}', 'MEMBER', now(), now()) on conflict do nothing`);
    if (teamId) sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tms${n}${stamp}', '${teamId}', '${who.id}', 'MEMBER', now(), now())`);
  };
  join(preacher, preaching.id, 1);
  join(musician, music.id, 2);
  join(visitor, null, 3);

  // A team's own event: its admins pick anyone.
  const own = (await call(planner, "POST", `/teams/${music.id}/events`, { title: "Practice", date: plus(4), startTime: "19:00", timeZone: "UTC", parts: [{ part: "SPEAKER", count: 1 }] })).body;
  let r = await call(planner, "POST", `/teams/${music.id}/events/${own.id}/dates/${plus(4)}/lineup`, { userId: musician.id, part: "SPEAKER" });
  check("a team's own event: a member speaks", r.status === 201, JSON.stringify(r.body));

  const made = (await call(planner, "POST", `/organizations/${org.id}/events`, { title: "Sunday", date: plus(3), startTime: "10:00", timeZone: "UTC", hostUserId: planner.id, needs: [{ teamId: music.id, parts: [{ part: "SPEAKER", count: 3, openTo: [preaching.id] }, { part: "DRUMS", count: 1 }] }] })).body;
  const event = (await call(planner, "GET", `/teams/${music.id}/events`)).body.find((one) => one.organizationEventId === made.id);
  const base = `/teams/${music.id}/events/${event.id}/dates/${plus(3)}`;
  r = await call(planner, "POST", `${base}/lineup`, { userId: musician.id, part: "SPEAKER" });
  check("an organisation's event: the admins put a member of the team on Speaker", r.status === 201, JSON.stringify(r.body));
  r = await call(planner, "POST", `${base}/lineup`, { guestName: "Pastor Jean", part: "SPEAKER" });
  check("a speaker without an account: not without an email", r.status === 400 && r.body.message.join().includes("guestEmail"), JSON.stringify(r.body));
  r = await call(planner, "POST", `${base}/lineup`, { guestName: "Pastor Jean", guestEmail: "Jean@Example.org", part: "SPEAKER" });
  check("…but a guest from outside, without an account, with an email, does", r.status === 201 && r.body.guest === "external" && r.body.guestEmail === "jean@example.org", JSON.stringify(r.body));
  r = await call(planner, "POST", `${base}/lineup`, { guestName: "Someone", guestEmail: "someone@example.org", part: "DRUMS" });
  check("any guest without an account comes with an email", r.status === 201 && r.body.guestEmail === "someone@example.org", JSON.stringify(r.body));
  const seen = async (who) => (await call(who, "GET", `/teams/${music.id}/event-dates?from=${plus(3)}&to=${plus(3)}`)).body.find((one) => one.eventId === event.id).lineup.find((place) => place.displayName === "Pastor Jean");
  check("the team's admins see the speaker's email", (await seen(planner))?.guestEmail === "jean@example.org");
  check("…its members don't", (await seen(musician))?.guestEmail === null, JSON.stringify(await seen(musician)));

  r = await call(planner, "POST", `${base}/lineup`, { userId: visitor.id, part: "SPEAKER" });
  check("someone outside the team and Preaching, not one of the planner's People: no", r.status === 400, JSON.stringify(r.body));
  r = await call(planner, "POST", `${base}/lineup`, { userId: preacher.id, part: "SPEAKER" });
  check("a member of Preaching, where the Speaker comes from, speaks at the music group's date", r.status === 201, JSON.stringify(r.body));
  r = await call(planner, "POST", `${base}/lineup`, { guestName: "Someone else", part: "DRUMS" });
  check("other parts: a guest by name alone, no", r.status === 400 && r.body.message.join().includes("guestEmail"), JSON.stringify(r.body));
  r = await call(musician, "PUT", `${base}/answer`, { answer: "AVAILABLE", wishes: ["SPEAKER"] });
  check("a member may wish to speak: no role is needed", r.status === 200, JSON.stringify(r.body));
  // An organisation's event (issue #523): a music group's part can go without a set - a meeting.
  const meeting = (await call(planner, "POST", `/organizations/${org.id}/events`, { title: "Members' meeting", date: plus(5), startTime: "19:00", timeZone: "UTC", hostUserId: planner.id, needs: [{ teamId: music.id, withSet: false }] })).body;
  check("an organisation's event: the music group's part without a set", meeting.needs?.[0]?.withSet === false, JSON.stringify(meeting));
  let dates = (await call(planner, "GET", `/teams/${music.id}/event-dates?from=${plus(5)}&to=${plus(5)}`)).body;
  check("…its date has none", dates.length === 1 && dates[0].setlistId === null && dates[0].withSet === false, JSON.stringify(dates));
  r = await call(planner, "PATCH", `/organizations/${org.id}/events/${meeting.id}`, { needs: [{ teamId: music.id }] });
  dates = (await call(planner, "GET", `/teams/${music.id}/event-dates?from=${plus(5)}&to=${plus(5)}`)).body;
  check("…and gets one when the need no longer says so", r.status === 200 && !!dates[0].setlistId, JSON.stringify(dates));
  await call(admin, "DELETE", `/admin/organizations/${org.id}`);
} finally {
  await call(admin, "DELETE", "/admin/organizations/settings");
}
await finish();
