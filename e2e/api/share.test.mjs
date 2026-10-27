// API-level checks for set sharing (issue #7): share links, guests, private notes, moving sets between personal and team, ownership requests.
import { API, stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const song = async (who, title, extra = {}) => (await call(who, "POST", "/song-versions", { artists: ["Test Artist"], title, language: "en", ...extra })).body;
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);


const anon = async (method, path) => {
  const res = await fetch(`${API}${path}`, { method });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

const owner = await user("owner");
const guest = await user("guest");
const outsider = await user("outsider");
const member = await user("member");
const admin2 = await user("admin2");

const team = (await call(owner, "POST", "/teams", { name: `Share Team ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now()), ('tma${stamp}', '${team.id}', '${admin2.id}', 'ADMIN', now(), now())`);
const otherTeam = (await call(member, "POST", "/teams", { name: `Other Team ${stamp}` })).body;

const personal = await song(owner, `Personal ${stamp}`);
await call(owner, "PATCH", `/song-versions/${personal.id}`, { contentFormat: "CHORDPRO", content: "{start_of_verse}\n[G]Hello [D]world\n{end_of_verse}\n" });
await call(owner, "PATCH", `/song-versions/${personal.id}`, { key: "G" });
const personal2 = await song(owner, `Personal Two ${stamp}`);
const personal3 = await song(owner, `Personal Three ${stamp}`);
const teamSong = await song(owner, `Team Song ${stamp}`, { teamId: team.id });
const globalSong = await song(owner, `Global ${stamp}`);
sql(`update "SongVersion" set "ownerScope"='GLOBAL', "ownerUserId"=null, "publicationState"='APPROVED' where id='${globalSong.id}'`);

let set = (await call(owner, "POST", "/setlists", { name: `Shared Set ${stamp}` })).body;
for (const s of [personal, teamSong, globalSong, personal2, personal3]) await call(owner, "POST", `/setlists/${set.id}/items`, { songVersionId: s.id });
set = (await call(owner, "GET", `/setlists/${set.id}`)).body;
const itemFor = (detail, songId) => detail.items.find((i) => (i.song?.id ?? i.songId) === songId) ?? detail.items.find((i) => i.versions?.some?.((v) => v.id === songId));
const personalItem = set.items[0];

// --- share link
let r = await call(owner, "GET", `/setlists/${set.id}/sharing`);
check("sharing starts off with no link or guests", r.status === 200 && r.body.link === null && r.body.guests.length === 0, JSON.stringify(r.body));
r = await call(owner, "POST", `/setlists/${set.id}/share-link`);
const firstToken = r.body.link?.token;
check("owner turns the link on", r.status === 201 && typeof firstToken === "string" && firstToken.length >= 20, JSON.stringify(r.body.link));
r = await call(owner, "POST", `/setlists/${set.id}/share-link`);
const token = r.body.link.token;
check("resetting issues a new token", token !== firstToken);
r = await anon("GET", `/set-invites/${firstToken}`);
check("the old link stops working", r.status === 404, String(r.status));
r = await anon("GET", `/set-invites/${token}`);
check("public preview says what the link leads to", r.status === 200 && r.body.name === `Shared Set ${stamp}` && r.body.ownerName === "owner" && r.body.itemCount === 5 && !("id" in r.body), JSON.stringify(r.body));
r = await call(member, "GET", `/setlists/${set.id}/sharing`);
check("non-editors can't see sharing settings", r.status === 404, String(r.status));

// --- guest
r = await call(guest, "POST", `/set-invites/${token}/join`);
check("guest joins through the link", r.status === 201 && r.body.setlistId === set.id, JSON.stringify(r.body));
r = await call(guest, "GET", `/setlists/${set.id}`);
check("guest sees the set read-only", r.status === 200 && r.body.isGuest === true && r.body.canEdit === false && r.body.ownerName === "owner");
check("guest can read every song, though none are in their library", r.body.items.every((i) => i.song !== null) && r.body.items.filter((i) => i.inLibrary).length === 1, r.body.items.map((i) => `${i.song?.title}:${i.inLibrary}`).join(" | "));
r = await call(guest, "GET", `/setlists/${set.id}/items/${personalItem.id}/song`);
check("guest opens a song's chart through the set", r.status === 200 && r.body.song.title === `Personal ${stamp}` && r.body.song.sections.length === 1 && r.body.song.key === "G" && r.body.nextItemId === set.items[1].id && r.body.previousItemId === null, JSON.stringify(r.body).slice(0, 200));
r = await call(guest, "GET", `/song-versions/${personal.id}`);
check("...but the song stays out of their library", r.status === 404 || r.status === 403, String(r.status));
r = await call(guest, "POST", `/setlists/${set.id}/items`, { songVersionId: globalSong.id });
check("guest can't add songs", r.status === 403, String(r.status));
r = await call(guest, "PATCH", `/setlists/${set.id}`, { name: "Hijacked" });
check("guest can't rename the set", r.status === 403, String(r.status));
r = await call(guest, "GET", "/setlists");
check("the set is in the guest's list, marked as a guest", r.body.some((s) => s.id === set.id && s.isGuest && !s.canEdit));
r = await call(guest, "POST", `/set-invites/${token}/join`);
check("joining twice is harmless", r.status === 201 && sql(`select count(*) from "SetlistGuest" where "setlistId"='${set.id}'`) === "1");
r = await call(owner, "POST", `/set-invites/${token}/join`);
check("the owner opening their own link isn't made a guest", r.body.setlistId === set.id && sql(`select count(*) from "SetlistGuest" where "setlistId"='${set.id}'`) === "1");

// --- private notes: a guest's own note, only in this set (issue #256)
r = await call(guest, "POST", "/notes", { songVersionId: personal.id, content: "  capo 2, soft intro  ", place: "ME", setlistId: set.id });
check("guest saves a note just for them in the set, on a song only the set lets them read", r.status === 201 && r.body.content === "capo 2, soft intro" && r.body.place === "ME" && r.body.placeId === set.id, JSON.stringify(r.body));
const guestNote = r.body;
r = await call(owner, "GET", `/song-versions/${personal.id}/notes?setlistId=${set.id}`);
check("the owner doesn't see the guest's note", r.status === 200 && !r.body.notes.some((n) => n.id === guestNote.id));
r = await call(guest, "GET", `/song-versions/${personal.id}/notes?setlistId=${set.id}`);
check("the guest does", r.status === 200 && r.body.notes.some((n) => n.id === guestNote.id));
r = await call(guest, "DELETE", `/notes/${guestNote.id}`);
check("…and deletes it", r.status === 204 && sql(`select count(*) from "Note" where id='${guestNote.id}'`) === "0");

// --- outsiders
r = await call(outsider, "GET", `/setlists/${set.id}`);
check("someone without the link still can't open it", r.status === 404, String(r.status));
r = await call(outsider, "GET", `/setlists/${set.id}/items/${personalItem.id}/song`);
check("...or its songs", r.status === 404, String(r.status));

// --- guest management
r = await call(owner, "GET", `/setlists/${set.id}/sharing`);
check("owner sees the guest list", r.body.guests.length === 1 && r.body.guests[0].email === guest.email);
r = await call(owner, "DELETE", `/setlists/${set.id}/guests/${guest.id}`);
check("owner removes a guest", r.status === 200 && r.body.guests.length === 0 && (await call(guest, "GET", `/setlists/${set.id}`)).status === 404);
await call(guest, "POST", `/set-invites/${token}/join`);
r = await call(guest, "POST", `/setlists/${set.id}/leave`);
check("a guest can leave", r.status === 204 && (await call(guest, "GET", `/setlists/${set.id}`)).status === 404);
r = await call(guest, "POST", `/setlists/${set.id}/leave`);
check("leaving twice is a 404", r.status === 404);
await call(owner, "DELETE", `/setlists/${set.id}/share-link`);
r = await call(guest, "POST", `/set-invites/${token}/join`);
check("a turned-off link can't be joined", r.status === 404, String(r.status));
const token2 = (await call(owner, "POST", `/setlists/${set.id}/share-link`)).body.link.token;
await call(guest, "POST", `/set-invites/${token2}/join`);

// --- moving to a team
r = await call(owner, "PATCH", `/setlists/${set.id}`, { teamId: otherTeam.id });
check("can't move a set to a team you don't admin", r.status === 403, String(r.status));
r = await call(owner, "PATCH", `/setlists/${set.id}`, { teamId: team.id });
check("owner moves the set to their team", r.status === 200 && r.body.teamId === team.id && r.body.ownerName === null, JSON.stringify({ s: r.status, t: r.body.teamId }));
const moved = r.body;
const byTitle = (detail, title) => detail.items.find((i) => i.song?.title === title);
check(
  "their personal songs stay in, marked as shared by them; team and global songs aren't",
  [personal, personal2, personal3].every((s) => byTitle(moved, s.title)?.sharedBy?.displayName === "owner") &&
    byTitle(moved, teamSong.title).sharedBy === null && byTitle(moved, globalSong.title).sharedBy === null,
  moved.items.map((i) => `${i.song?.title}:${i.sharedBy?.displayName ?? "-"}`).join(" | "),
);
r = await call(member, "GET", `/setlists/${set.id}`);
check("team members can read the shared songs, read-only", r.status === 200 && r.body.canEdit === false && byTitle(r.body, personal.title) && !byTitle(r.body, personal.title).inLibrary, r.body.items.map((i) => i.song?.title ?? "(hidden)").join(" | "));
r = await call(member, "GET", `/setlists/${set.id}/items/${personalItem.id}/song`);
check("...including the chart", r.status === 200 && r.body.song.sections.length === 1 && r.body.sharedBy.displayName === "owner");
r = await call(guest, "GET", `/setlists/${set.id}`);
check("guests keep their access after the move", r.status === 200 && r.body.isGuest && r.body.items.every((i) => i.song !== null));
r = await call(owner, "POST", `/setlists/${set.id}/items`, { songVersionId: (await song(owner, `New Personal ${stamp}`)).id });
// Not without sharing it with the team, or moving it there (issue #331, see song-team-shares).
check("a team set still asks before taking a new personal song", r.status === 409 && r.body.code === "SONG_NOT_SHARED", String(r.status));

// --- ownership requests
const item1 = byTitle(moved, personal.title);
const item2 = byTitle(moved, personal2.title);
const item3 = byTitle(moved, personal3.title);
check("team admins are offered to ask for shared personal songs", item1.canRequestOwnership && !byTitle(moved, teamSong.title).canRequestOwnership);
r = await call(member, "POST", `/setlists/${set.id}/items/${item1.id}/ownership-request`);
check("a plain member can't ask", r.status === 403, String(r.status));
r = await call(admin2, "POST", `/setlists/${set.id}/items/${item1.id}/ownership-request`);
check("another team admin asks for a song", r.status === 201 && byTitle(r.body, personal.title).ownershipRequest && !byTitle(r.body, personal.title).ownershipRequest.canDecide && !byTitle(r.body, personal.title).canRequestOwnership);
r = await call(admin2, "POST", `/setlists/${set.id}/items/${item1.id}/ownership-request`);
check("asking twice is refused", r.status === 409, String(r.status));
r = await call(owner, "GET", "/ownership-requests");
const req1 = r.body.find((q) => q.song.id === personal.id);
check("the song's owner sees the request", r.status === 200 && req1 && req1.team.name === team.name && req1.requestedByName === "admin2" && req1.ownerIsTeamMember === true, JSON.stringify(r.body));
r = await call(admin2, "POST", `/ownership-requests/${req1.id}/accept`);
check("only the owner can accept", r.status === 403, String(r.status));
r = await call(owner, "POST", `/ownership-requests/${req1.id}/decline`);
check("owner declines", r.status === 204 && sql(`select "ownerScope" from "SongVersion" where id='${personal.id}'`) === "USER");
r = await call(owner, "POST", `/ownership-requests/${req1.id}/accept`);
check("a decided request can't be decided again", r.status === 409, String(r.status));
await call(admin2, "POST", `/setlists/${set.id}/items/${item1.id}/ownership-request`);
const req1b = (await call(owner, "GET", "/ownership-requests")).body.find((q) => q.song.id === personal.id);
r = await call(owner, "POST", `/ownership-requests/${req1b.id}/accept`);
const afterAccept = (await call(owner, "GET", `/setlists/${set.id}`)).body;
check(
  "accepting moves the song to the team and it's no longer 'shared'",
  r.status === 204 && sql(`select "ownerScope" || ':' || coalesce("ownerTeamId",'') || ':' || coalesce("ownerUserId",'-') from "SongVersion" where id='${personal.id}'`) === `TEAM:${team.id}:-` && byTitle(afterAccept, personal.title).sharedBy === null,
);
r = await call(member, "GET", `/song-versions/${personal.id}`);
check("team members now have it in their library", r.status === 200, String(r.status));
r = await call(owner, "POST", `/setlists/${set.id}/items/${item2.id}/ownership-request`);
check("an admin who owns a shared song hands it over directly", r.status === 201 && sql(`select "ownerScope" from "SongVersion" where id='${personal2.id}'`) === "TEAM" && byTitle(r.body, personal2.title).sharedBy === null);

// --- the sharer losing access hides the song again
sql(`update "SongVersion" set "ownerUserId"='${outsider.id}' where id='${personal3.id}'`);
r = await call(member, "GET", `/setlists/${set.id}`);
check("a shared song its sharer can no longer see is hidden again", r.body.items.some((i) => i.id === item3.id && i.song === null), r.body.items.map((i) => i.song?.title ?? "(hidden)").join(" | "));
sql(`update "SongVersion" set "ownerUserId"='${owner.id}' where id='${personal3.id}'`);

// --- back to personal
r = await call(member, "PATCH", `/setlists/${set.id}`, { teamId: null });
check("a plain member can't take a team set", r.status === 403, String(r.status));
r = await call(owner, "PATCH", `/setlists/${set.id}`, { teamId: null });
check(
  "a team admin makes it their personal set; their own songs no longer need sharing",
  r.status === 200 && r.body.teamId === null && r.body.ownerName === "owner" && byTitle(r.body, personal3.title).sharedBy === null,
  r.body.items?.map((i) => `${i.song?.title}:${i.sharedBy?.displayName ?? "-"}`).join(" | "),
);
r = await call(member, "GET", `/setlists/${set.id}`);
check("team members lose access to the now-personal set", r.status === 404, String(r.status));

finish();
