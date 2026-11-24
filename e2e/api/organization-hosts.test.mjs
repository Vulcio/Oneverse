// Who may host (issues #520, #559): a member of the team or its
// organisation, never a guest - whoever the admins put there. No role gives
// it: an event takes its Host from a team ("Présidence", one of the
// organisation's groups), whose members offer to host and may be put on it
// without being in the team that has the date.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Org hosts admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const orgAdmin = await user("Org hosts planner");
const presider = await user("Org hosts presider");
const visitor = await user("Org hosts visitor");
const musician = await user("Org hosts musician");
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
try {
  const org = (await call(orgAdmin, "POST", "/organizations", { name: `Hosts church ${stamp}` })).body;
  const music = (await call(orgAdmin, "POST", `/organizations/${org.id}/groups`, { name: `Music ${stamp}`, usesSongverse: true })).body;
  const presidency = (await call(orgAdmin, "POST", `/organizations/${org.id}/groups`, { name: `Présidence ${stamp}` })).body;
  const join = (who, teamId, n) => {
    sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('omh${n}${stamp}', '${org.id}', '${who.id}', 'MEMBER', now(), now()) on conflict do nothing`);
    if (teamId) sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmh${n}${stamp}', '${teamId}', '${who.id}', 'MEMBER', now(), now())`);
  };
  join(presider, presidency.id, 1);
  join(musician, music.id, 2);
  join(visitor, null, 3);

  // A team's own event: its admins name whoever they like.
  const own = (await call(orgAdmin, "POST", `/teams/${music.id}/events`, { title: "Rehearsal", date: plus(4), startTime: "19:00", timeZone: "UTC", parts: [{ part: "HOST", count: 1 }] })).body;
  const ownBase = `/teams/${music.id}/events/${own.id}/dates/${plus(4)}`;
  let r0 = await call(musician, "PUT", `${ownBase}/answer`, { answer: "AVAILABLE", wishes: ["HOST"] });
  check("a team's own event: any member may wish to host", r0.status === 200 && r0.body.wishes.join() === "HOST", JSON.stringify(r0.body));
  r0 = await call(orgAdmin, "POST", `${ownBase}/lineup`, { userId: musician.id, part: "HOST" });
  check("…and its admins put whoever they like on it", r0.status === 201, JSON.stringify(r0.body));
  r0 = await call(orgAdmin, "POST", `${ownBase}/lineup`, { guestName: "Visiting pastor", part: "HOST" });
  check("…but never a guest: hosting is a member's", r0.status === 400, JSON.stringify(r0.body));
  r0 = await call(orgAdmin, "POST", `${ownBase}/lineup`, { userId: visitor.id, part: "HOST" });
  check("…someone of the team's organisation, though, yes", r0.status === 201, JSON.stringify(r0.body));

  // The organisation's event: its Host comes from the Présidence group.
  const made = (await call(orgAdmin, "POST", `/organizations/${org.id}/events`, { title: "Sunday", date: plus(3), startTime: "10:00", timeZone: "UTC", hostUserId: orgAdmin.id, needs: [{ teamId: music.id, parts: [{ part: "HOST", count: 1, openTo: [presidency.id] }, { part: "DRUMS", count: 1 }] }] })).body;
  const event = (await call(orgAdmin, "GET", `/teams/${music.id}/events`)).body.find((one) => one.organizationEventId === made.id);
  check("the organisation's event, on the music group's calendar, its Host from Présidence", event?.parts.find((part) => part.part === "HOST")?.openTo?.join() === presidency.id, JSON.stringify(event));
  const base = `/teams/${music.id}/events/${event.id}/dates/${plus(3)}`;
  let r = await call(presider, "POST", "/users/me/open-places", { teamId: music.id, eventId: event.id, date: plus(3), part: "HOST" });
  check("a member of Présidence offers to host the music group's date", r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  r = await call(musician, "POST", "/users/me/open-places", { teamId: music.id, eventId: event.id, date: plus(3), part: "HOST" });
  check("…the music group's own members can't: it isn't open to them", r.status === 400, JSON.stringify(r.body));
  r = await call(musician, "PUT", `${base}/answer`, { answer: "AVAILABLE", wishes: ["HOST"] });
  check("…though they may wish for it, and no role is needed", r.status === 200 && r.body.wishes.join() === "HOST", JSON.stringify(r.body));
  r = await call(orgAdmin, "POST", `${base}/lineup`, { guestName: "Visiting pastor", part: "HOST" });
  check("never a guest", r.status === 400, JSON.stringify(r.body));
  const roles = await call(orgAdmin, "POST", `/organizations/${org.id}/roles`, { name: "Hosts", canHost: true });
  check("no role hosts any more", roles.status === 400, JSON.stringify(roles.body));
  await call(admin, "DELETE", `/admin/organizations/${org.id}`);
} finally {
  await call(admin, "DELETE", "/admin/organizations/settings");
}
await finish();
