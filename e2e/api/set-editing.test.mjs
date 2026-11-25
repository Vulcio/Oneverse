// One set per event date, viewed by its teams, edited by the ones chosen
// (issue #578). An organisation's event has one set per date for all the
// groups it needs: every group views it; in the groups that edit it, their
// admins and their people on the date's line-up edit it. A date can give
// editing to a group that usually only views it, and someone who only views
// it asks to edit it: those who edit it are told, and grant or decline.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);
const admin = await user("Set editing global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const planner = await user("Set editing planner");
const drummer = await user("Set editing drummer");
const singer = await user("Set editing singer");
const presider = await user("Set editing presider");
const techie = await user("Set editing techie");

await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
try {
  const org = (await call(planner, "POST", "/organizations", { name: `Set editing church ${stamp}` })).body;
  const base = `/organizations/${org.id}`;
  // A group that only plans (the hosts), the music group, and a media group whose line-up only views the set.
  const hosts = (await call(planner, "POST", `${base}/groups`, { name: `Hosts ${stamp}` })).body;
  const music = (await call(planner, "POST", `${base}/groups`, { name: `Music ${stamp}`, usesSongverse: true })).body;
  const media = (await call(planner, "POST", `${base}/groups`, { name: `Media ${stamp}`, usesSongverse: true })).body;
  const join = (who, teamId, n) => {
    sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('omse${n}${stamp}', '${org.id}', '${who.id}', 'MEMBER', now(), now()) on conflict do nothing`);
    sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmse${n}${stamp}', '${teamId}', '${who.id}', 'MEMBER', now(), now())`);
  };
  join(presider, hosts.id, 1);
  join(drummer, music.id, 2);
  join(singer, music.id, 3);
  join(techie, media.id, 4);

  // --- an organisation's event: one set per date, the groups that edit it
  const date = plus(5);
  let r = await call(planner, "POST", `${base}/events`, {
    title: "Sunday",
    date,
    startTime: "10:00",
    timeZone: "UTC",
    hostUserId: planner.id,
    needs: [
      { teamId: hosts.id, parts: [{ part: "HOST", count: 1 }] },
      { teamId: music.id, parts: [{ part: "DRUMS", count: 1 }] },
      { teamId: media.id, editsSet: false },
    ],
  });
  check("an organisation's event with a set for each date", r.status === 201 && r.body.withSet === true, JSON.stringify(r.body));
  const need = (teamId) => r.body.needs.find((one) => one.teamId === teamId);
  check("…the groups that edit it: those that use Songverse, unless told", need(hosts.id)?.editsSet === false && need(music.id)?.editsSet === true && need(media.id)?.editsSet === false, JSON.stringify(r.body.needs));
  const event = r.body;
  const partOf = (teamId) => event.needs.find((one) => one.teamId === teamId).teamEventId;
  const setOf = async (teamId) => (await call(planner, "GET", `/teams/${teamId}/event-dates?from=${date}&to=${date}`)).body.find((one) => one.eventId === partOf(teamId))?.setlistId;
  const setlistId = await setOf(music.id);
  check("one set for the date, every group's", !!setlistId && (await setOf(hosts.id)) === setlistId && (await setOf(media.id)) === setlistId, JSON.stringify([setlistId, await setOf(hosts.id), await setOf(media.id)]));
  const set = (who) => call(who, "GET", `/setlists/${setlistId}`);
  check("…owned by the first group that edits it (not the hosts, listed first)", (await set(planner)).body.teamId === music.id, JSON.stringify((await set(planner)).body.teamId));

  // --- who edits it
  await call(planner, "POST", `/teams/${music.id}/events/${partOf(music.id)}/dates/${date}/lineup`, { userId: drummer.id, part: "DRUMS" });
  await call(planner, "POST", `/teams/${hosts.id}/events/${partOf(hosts.id)}/dates/${date}/lineup`, { userId: presider.id, part: "HOST" });
  let mine = (await set(drummer)).body;
  check("the music group's drummer on the line-up edits it, without deleting it", mine.canEdit === true && mine.canManage === false, JSON.stringify({ canEdit: mine.canEdit, canManage: mine.canManage }));
  mine = (await set(singer)).body;
  check("a member of it not on the line-up views it", mine.canEdit === false && mine.canAskToEdit === true, JSON.stringify({ canEdit: mine.canEdit, ask: mine.canAskToEdit }));
  mine = (await set(presider)).body;
  check("the host, of a group that views it, views it", mine.canEdit === false && mine.isGuest === false, JSON.stringify(mine.canEdit));
  r = await set(techie);
  check("the media group views it too", r.status === 200 && r.body.canEdit === false, String(r.status));
  check("…and it's in their sets", (await call(techie, "GET", "/setlists")).body.some((one) => one.id === setlistId && one.canEdit === false && one.isGuest === false));
  r = await call(presider, "POST", `/setlists/${setlistId}/items`, { text: { title: "Welcome", body: "Hello" } });
  check("…so the host can't change it", r.status === 403, String(r.status));

  // --- one date gives editing to a group that usually views it
  const editorsOn = (who, body) => call(who, "PUT", `${base}/events/${event.id}/dates/${date}/editors`, body);
  r = await editorsOn(drummer, { teamId: hosts.id, editsSet: true });
  check("only the organisation's admins and the organiser choose it", r.status === 403, String(r.status));
  r = await editorsOn(planner, { teamId: hosts.id, editsSet: true });
  check("the hosts edit this date's set", r.status === 204 && (await set(presider)).body.canEdit === true, String(r.status));
  const shown = (await call(planner, "GET", `${base}/event-dates?from=${date}&to=${date}`)).body[0];
  const hostsShown = shown.groups.find((group) => group.teamId === hosts.id);
  check("…the date says so, as an exception", hostsShown.editsSet === true && hostsShown.dateEditsSet === true, JSON.stringify(hostsShown));
  r = await editorsOn(planner, { teamId: hosts.id, editsSet: null });
  check("back to usual: they view it", r.status === 204 && (await set(presider)).body.canEdit === false);
  r = await editorsOn(planner, { teamId: org.id, editsSet: true });
  check("a team the event doesn't need: refused", r.status === 400, JSON.stringify(r.body));
  r = await call(planner, "PUT", `${base}/events/${event.id}/dates/${plus(6)}/editors`, { teamId: hosts.id, editsSet: true });
  check("a day the event isn't on: not found", r.status === 404, String(r.status));

  // --- asking to edit it
  r = await call(drummer, "POST", `/setlists/${setlistId}/edit-requests`);
  check("someone who edits it doesn't ask", r.status === 400, JSON.stringify(r.body));
  r = await call(techie, "POST", `/setlists/${setlistId}/edit-requests`);
  check("the techie asks to edit it", (r.status === 201 || r.status === 200) && r.body.status === "PENDING", JSON.stringify(r.body));
  check("…those who edit it are told: the line-up's drummer", (await notes(drummer, "SET_EDIT_REQUESTED")).some((one) => one.url === `/sets/${setlistId}`));
  check("…not someone who only views it", (await notes(singer, "SET_EDIT_REQUESTED")).length === 0);
  check("…their page says they asked", (await set(techie)).body.myEditRequest?.status === "PENDING");
  r = await call(techie, "POST", `/setlists/${setlistId}/edit-requests`);
  check("asking again while waiting: one ask, no new notification", r.body.status === "PENDING" && (await notes(drummer, "SET_EDIT_REQUESTED")).length === 1);
  r = await call(singer, "GET", `/setlists/${setlistId}/edit-requests`);
  check("someone who only views it doesn't see the asks", r.status === 403, String(r.status));
  r = await call(drummer, "GET", `/setlists/${setlistId}/edit-requests`);
  const asked = r.body.find((one) => one.userId === techie.id);
  check("the drummer sees it", r.status === 200 && asked?.status === "PENDING" && asked.displayName === "Set editing techie", JSON.stringify(r.body));
  r = await call(drummer, "PUT", `/setlists/${setlistId}/edit-requests/${asked.id}`, { grant: true });
  check("…and grants it", r.status === 200 && r.body.status === "GRANTED" && r.body.decidedBy === "Set editing drummer", JSON.stringify(r.body));
  check("the techie edits the set now, and is told", (await set(techie)).body.canEdit === true && (await notes(techie, "SET_EDIT_GRANTED")).length === 1);
  r = await call(techie, "GET", `/setlists/${setlistId}/edit-requests`);
  check("…but someone granted doesn't decide others' asks", r.status === 403, String(r.status));

  r = await call(singer, "POST", `/setlists/${setlistId}/edit-requests`);
  const sung = r.body;
  r = await call(planner, "PUT", `/setlists/${setlistId}/edit-requests/${sung.id}`, { grant: false });
  check("the group's admin declines the singer's ask", r.status === 200 && r.body.status === "DECLINED" && (await notes(singer, "SET_EDIT_DECLINED")).length === 1, JSON.stringify(r.body));
  check("…who still views it", (await set(singer)).body.canEdit === false);
  r = await call(singer, "POST", `/setlists/${setlistId}/edit-requests`);
  check("…and may ask again", r.body.status === "PENDING", JSON.stringify(r.body));

  // --- an organisation's event type carries the groups that edit
  r = await call(planner, "POST", `${base}/event-types`, { name: `Prayer ${stamp}`, editingTeamIds: [media.id] });
  check("an organisation's type keeps the groups that edit its sets", r.status === 201 && r.body.editingTeamIds.join() === media.id, JSON.stringify(r.body));
  r = await call(planner, "PATCH", `${base}/event-types/${r.body.id}`, { editingTeamIds: ["not-a-group"] });
  check("…only its groups", r.status === 400, JSON.stringify(r.body));

  // --- cancelled for every group: its empty set goes; back, one set again
  const second = plus(12);
  const weekly = (await call(planner, "POST", `${base}/events`, { title: "Evening", date: plus(5), startTime: "18:00", timeZone: "UTC", hostUserId: planner.id, repeat: { everyWeeks: 1 }, needs: [{ teamId: music.id }, { teamId: media.id }] })).body;
  const weeklySet = async (teamId) => (await call(planner, "GET", `/teams/${teamId}/event-dates?from=${second}&to=${second}`)).body.find((one) => one.eventId === weekly.needs.find((n) => n.teamId === teamId).teamEventId)?.setlistId ?? null;
  const before = await weeklySet(music.id);
  await call(planner, "PATCH", `${base}/events/${weekly.id}/dates/${second}`, { cancelled: true });
  check("a date cancelled: its empty set goes", !!before && (await weeklySet(music.id)) === null && (await weeklySet(media.id)) === null && (await set(planner)).status === 200 && (await call(planner, "GET", `/setlists/${before}`)).status === 404);
  await call(planner, "PATCH", `${base}/events/${weekly.id}/dates/${second}`, { cancelled: false });
  const again = await weeklySet(music.id);
  check("…back: one set again, every group's", !!again && (await weeklySet(media.id)) === again, JSON.stringify([again, await weeklySet(media.id)]));
  r = await call(planner, "PATCH", `${base}/events/${weekly.id}`, { withSet: false });
  check("no sets any more: coming empty ones go", r.status === 200 && r.body.withSet === false && (await weeklySet(music.id)) === null && (await call(planner, "GET", `/setlists/${again}`)).status === 404, JSON.stringify(r.body.withSet));

  await call(admin, "DELETE", `/admin/organizations/${org.id}`);
} finally {
  await call(admin, "DELETE", "/admin/organizations/settings");
}
finish();
