// A team's songbook takes only songs everyone in the team can open, as a
// team's set does (issue #340): one's own personal song is shared with the
// team or moved to it first, asked with SONG_NOT_SHARED; someone else's
// song the team can't open is refused - its members would get a 403.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const admin = await user("book admin");
const member = await user("book member");
const friend = await user("book friend");
const team = (await call(admin, "POST", "/teams", { name: `Books ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmb${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const book = (await call(admin, "POST", "/songbooks", { name: `Team book ${stamp}`, kind: "SIMPLE", teamId: team.id })).body;
check("a team's songbook", book.ownerTeamId === team.id, JSON.stringify(book).slice(0, 200));
const song = async (who, title, extra = {}) => (await call(who, "POST", "/song-versions", { title, language: "en", artists: ["Book Artist"], ...extra })).body;
const teamSong = await song(admin, `Team's ${stamp}`, { teamId: team.id });
const shareMe = await song(admin, `Shared ${stamp}`);
const moveMe = await song(admin, `Moved ${stamp}`);
const friends = await song(friend, `Friend's ${stamp}`);
sql(`insert into "AccessGrant" (id, "songVersionId", "grantedToUserId", "grantedByUserId", "canEdit", "createdAt") values ('ag${stamp}', '${friends.id}', '${admin.id}', '${friend.id}', false, now())`);

let r = await call(admin, "POST", `/songbooks/${book.id}/entries`, { songVersionId: teamSong.id });
check("the team's song goes in", r.status === 201, `${r.status} ${r.body?.message}`);
r = await call(admin, "POST", `/songbooks/${book.id}/entries`, { songVersionId: shareMe.id });
check("one's own song: asked first", r.status === 409 && r.body?.code === "SONG_NOT_SHARED", `${r.status} ${JSON.stringify(r.body)}`);
r = await call(admin, "POST", `/songbooks/${book.id}/entries`, { songVersionId: shareMe.id, teamAccess: "share" });
check("…shared with the team, it goes in", r.status === 201 && sql(`select count(*) from "AccessGrant" where "songVersionId"='${shareMe.id}' and "grantedToTeamId"='${team.id}'`) === "1", `${r.status} ${r.body?.message}`);
r = await call(admin, "POST", `/songbooks/${book.id}/entries`, { songVersionId: moveMe.id, teamAccess: "move" });
check("…or moved to the team", r.status === 201 && sql(`select "ownerTeamId" from "SongVersion" where id='${moveMe.id}'`) === team.id, `${r.status} ${r.body?.message}`);
r = await call(admin, "POST", `/songbooks/${book.id}/entries`, { songVersionId: friends.id });
check("someone else's song the team can't open: refused", r.status === 400, `${r.status} ${r.body?.message}`);
r = await call(admin, "POST", `/songbooks/${book.id}/entries`, { songVersionId: friends.id, teamAccess: "share" });
check("…even asking to share it", r.status === 400, String(r.status));

for (const one of [teamSong, shareMe, moveMe]) {
  r = await call(member, "GET", `/song-versions/${one.id}`);
  check(`a member opens ${one.title.split(" ")[0]} from the songbook`, r.status === 200, String(r.status));
}
r = await call(member, "GET", `/songbooks/${book.id}`);
check("the songbook shows the member all three", r.status === 200 && r.body.entries.length === 3, String(r.body?.entries?.length));

const mine = (await call(admin, "POST", "/songbooks", { name: `Own book ${stamp}`, kind: "SIMPLE" })).body;
r = await call(admin, "POST", `/songbooks/${mine.id}/entries`, { songVersionId: friends.id, teamAccess: "share" });
check("teamAccess is for a team's songbook only", r.status === 400, String(r.status));
r = await call(admin, "POST", `/songbooks/${mine.id}/entries`, { songVersionId: friends.id });
check("a personal songbook takes what its owner sees", r.status === 201, `${r.status} ${r.body?.message}`);

finish();
