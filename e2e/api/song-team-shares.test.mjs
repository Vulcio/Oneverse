// A song shared with a team, or moved to one (issue #331): everyone in the
// team sees it and the team's sets take it; to edit, its admins edit it;
// adding one's own personal song to a team's set asks to share or move it;
// a member offers a song to the team and its admins accept.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const owner = await user("teamshare owner");
const admin = await user("teamshare admin");
const member = await user("teamshare member");
const outsider = await user("teamshare outsider");

const team = (await call(admin, "POST", "/teams", { name: `Team share ${stamp}` })).body;
sql(
  `insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tso${stamp}', '${team.id}', '${owner.id}', 'MEMBER', now(), now()), ('tsm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`,
);
const song = async (who, title) => (await call(who, "POST", "/song-versions", { artists: ["Band"], title, language: "en", content: "[G]Hello [D]world\n" })).body;
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);

// --- sharing with a team
const shared = await song(owner, `Shared ${stamp}`);
let r = await call(member, "GET", `/song-versions/${shared.id}`);
check("a personal song is its owner's alone", r.status === 403 || r.status === 404, String(r.status));
r = await call(outsider, "PUT", `/song-versions/${shared.id}/shares/teams/${team.id}`, { canEdit: false });
check("only who manages a song shares it", r.status === 403, String(r.status));
const outsiderSong = await song(outsider, `Outsider ${stamp}`);
r = await call(outsider, "PUT", `/song-versions/${outsiderSong.id}/shares/teams/${team.id}`, { canEdit: false });
check("…and only with a team they're in", r.status === 403, String(r.status));
r = await call(owner, "PUT", `/song-versions/${shared.id}/shares/teams/${team.id}`, { canEdit: false });
check("its owner shares it with their team, to view", r.status === 200 && r.body.length === 1 && r.body[0].team.id === team.id && r.body[0].canEdit === false, JSON.stringify(r.body));
r = await call(owner, "GET", `/song-versions/${shared.id}/shares/teams`);
check("…listed with the teams it's shared with", r.status === 200 && r.body[0]?.team.name === team.name);
r = await call(member, "GET", `/song-versions/${shared.id}/shares/teams`);
check("…which only who manages it sees", r.status === 403, String(r.status));

r = await call(member, "GET", `/song-versions/${shared.id}`);
check("everyone in the team opens it, told it's shared with the team", r.status === 200 && r.body.sharedBy?.team?.id === team.id && r.body.sharedBy.canEdit === false, JSON.stringify(r.body.sharedBy));
r = await call(member, "GET", `/song-versions?q=${encodeURIComponent(`Shared ${stamp}`)}`);
check("…and finds it in their library", r.body.items?.some((item) => item.id === shared.id && item.sharedBy?.team?.id === team.id));
r = await call(outsider, "GET", `/song-versions/${shared.id}`);
check("someone outside the team doesn't", r.status === 403 || r.status === 404, String(r.status));
r = await call(admin, "PATCH", `/song-versions/${shared.id}`, { title: `Shared ${stamp} (admin)` });
check("shared to view: not even the team's admins change it", r.status === 403, String(r.status));
r = await call(member, "DELETE", `/song-versions/${shared.id}/shares/me`);
check("a team's share isn't a member's to leave", r.status === 404, String(r.status));

r = await call(owner, "PUT", `/song-versions/${shared.id}/shares/teams/${team.id}`, { canEdit: true });
r = await call(admin, "GET", `/song-versions/${shared.id}`);
check("shared to edit: the team's admins can edit it", r.body.canEdit === true && r.body.canManage === false && r.body.sharedBy?.canEdit === true, JSON.stringify({ canEdit: r.body.canEdit, canManage: r.body.canManage }));
r = await call(admin, "PATCH", `/song-versions/${shared.id}`, { title: `Shared ${stamp} (admin)` });
check("…and change it", r.status === 200 && r.body.title === `Shared ${stamp} (admin)`, String(r.status));
r = await call(member, "PATCH", `/song-versions/${shared.id}`, { title: "Nope" });
check("…while its members still only view it", r.status === 403, String(r.status));
r = await call(admin, "PUT", `/song-versions/${shared.id}/shares/teams/${team.id}`, { canEdit: false });
check("editing it isn't sharing it: only who manages it does", r.status === 403, String(r.status));

// --- a team's set takes a song shared with the team
const teamSet = (await call(admin, "POST", "/setlists", { name: `Team share set ${stamp}`, teamId: team.id })).body;
r = await call(admin, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: shared.id });
check("a team's set takes a song shared with the team", r.status === 201 && r.body.items.some((item) => item.song?.id === shared.id), JSON.stringify(r.body).slice(0, 200));
r = await call(member, "GET", `/setlists/${teamSet.id}`);
check("…which its members read in it", r.body.items.find((item) => item.songId === shared.id || item.song?.id === shared.id)?.song?.title === `Shared ${stamp} (admin)`);
r = await call(owner, "DELETE", `/song-versions/${shared.id}/shares/teams/${team.id}`);
check("its owner stops sharing it", r.status === 200 && r.body.length === 0, JSON.stringify(r.body));
r = await call(member, "GET", `/song-versions/${shared.id}`);
check("…and the team no longer opens it", r.status === 403 || r.status === 404, String(r.status));
r = await call(member, "GET", `/setlists/${teamSet.id}`);
check("…nor reads it in the team's set", r.body.items.length === 1 && r.body.items[0].song === null, JSON.stringify(r.body.items[0]).slice(0, 200));

// --- adding one's own personal song to a team's set
const mine = await song(admin, `Mine ${stamp}`);
r = await call(admin, "GET", `/song-versions?q=${encodeURIComponent(`Mine ${stamp}`)}&addableTo=${teamSet.id}`);
check("Add songs lists one's own personal songs for a team's set", r.body.items?.some((item) => item.id === mine.id));
r = await call(admin, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: mine.id });
check("adding one asks first: share or move it", r.status === 409 && r.body.code === "SONG_NOT_SHARED" && r.body.team?.id === team.id, JSON.stringify(r.body));
r = await call(admin, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: mine.id, teamAccess: "share" });
check("shared with the team as it's added", r.status === 201 && r.body.items.some((item) => item.song?.id === mine.id), String(r.status));
r = await call(admin, "GET", `/song-versions/${mine.id}/shares/teams`);
check("…to view, and still theirs", r.body[0]?.team.id === team.id && r.body[0].canEdit === false && (await call(admin, "GET", `/song-versions/${mine.id}`)).body.ownerScope === "USER");

const moving = await song(admin, `Moving ${stamp}`);
r = await call(admin, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: moving.id, teamAccess: "move" });
check("or moved to the team as it's added", r.status === 201, String(r.status));
r = await call(member, "GET", `/song-versions/${moving.id}`);
check("…the team's song now", r.status === 200 && r.body.ownerScope === "TEAM" && r.body.ownerTeamId === team.id, JSON.stringify({ scope: r.body.ownerScope }));

const othersSong = await song(member, `Others ${stamp}`);
sql(`insert into "Connection" (id, "requesterId", "addresseeEmail", "addresseeId", status, "respondedAt") values ('cts${stamp}', '${member.id}', '${admin.email}', '${admin.id}', 'ACCEPTED', now())`);
r = await call(member, "PUT", `/song-versions/${othersSong.id}/shares/${admin.id}`, { canEdit: true });
check("(someone else's song, shared with them to edit)", r.status === 200, String(r.status));
r = await call(admin, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: othersSong.id, teamAccess: "share" });
check("someone else's song isn't theirs to share into the team's set", r.status === 400, String(r.status));
r = await call(admin, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: shared.id, teamAccess: "share" });
check("…nor one they can't see", r.status === 400, String(r.status));

// --- moving a song to a team from the song: offered by a member, accepted by an admin
const offered = await song(owner, `Offered ${stamp}`);
r = await call(owner, "POST", `/song-versions/${offered.id}/move-to-team`, { teamId: team.id });
check("a member offers their song to the team", r.status === 201 && r.body.moved === false, JSON.stringify(r.body));
r = await call(owner, "POST", `/song-versions/${offered.id}/move-to-team`, { teamId: team.id });
check("…once", r.status === 409, String(r.status));
check("…and still owns it", (await call(owner, "GET", `/song-versions/${offered.id}`)).body.ownerScope === "USER");
check("the team's admins are told", (await notes(admin, "SONG_OFFERED")).some((note) => note.data.song === `Offered ${stamp}` && note.data.team === team.name));
r = await call(admin, "GET", "/ownership-requests");
const offer = r.body.find((request) => request.song.id === offered.id);
check("…and find it waiting on them, as an offer", offer?.kind === "offer" && offer.team.id === team.id && offer.requestedByName === "teamshare owner", JSON.stringify(offer));
check("…not its owner", !(await call(owner, "GET", "/ownership-requests")).body.some((request) => request.song.id === offered.id));
r = await call(member, "POST", `/ownership-requests/${offer.id}/accept`);
check("a member can't accept it", r.status === 403, String(r.status));
r = await call(admin, "POST", `/ownership-requests/${offer.id}/accept`);
check("an admin accepts it", r.status === 204, String(r.status));
r = await call(member, "GET", `/song-versions/${offered.id}`);
check("…and it's the team's song", r.status === 200 && r.body.ownerScope === "TEAM" && r.body.ownerTeamId === team.id);
r = await call(owner, "PATCH", `/song-versions/${offered.id}`, { title: "Mine again" });
check("…which its former owner, a member, no longer changes", r.status === 403, String(r.status));

const declined = await song(owner, `Declined ${stamp}`);
await call(owner, "POST", `/song-versions/${declined.id}/move-to-team`, { teamId: team.id });
const offer2 = (await call(admin, "GET", "/ownership-requests")).body.find((request) => request.song.id === declined.id);
r = await call(admin, "POST", `/ownership-requests/${offer2.id}/decline`);
check("an admin can decline an offer", r.status === 204 && (await call(owner, "GET", `/song-versions/${declined.id}`)).body.ownerScope === "USER", String(r.status));

const direct = await song(admin, `Direct ${stamp}`);
r = await call(admin, "POST", `/song-versions/${direct.id}/move-to-team`, { teamId: team.id });
check("an admin's own song moves at once", r.status === 201 && r.body.moved === true && (await call(member, "GET", `/song-versions/${direct.id}`)).body.ownerScope === "TEAM", JSON.stringify(r.body));
r = await call(admin, "POST", `/song-versions/${direct.id}/move-to-team`, { teamId: team.id });
check("only a personal song moves", r.status === 400, String(r.status));
r = await call(outsider, "POST", `/song-versions/${outsiderSong.id}/move-to-team`, { teamId: team.id });
check("not to a team they're not in", r.status === 403, String(r.status));

finish();
