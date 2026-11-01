// Giving a personal songbook to a team (issue #211), and leaving one shared
// with you: one of the team's admins makes it the team's, their own songs in
// it moved to the team or shared with it; a member shares it instead.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const owner = await user("give owner");
const member = await user("give member");
const friend = await user("give friend");
const team = (await call(owner, "POST", "/teams", { name: `Give team ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('gm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const song = async (who, title) => (await call(who, "POST", "/song-versions", { artists: ["Band"], title, language: "en", content: "[G]Hello\n" })).body;
const book = async (who, name, songs) => {
  const created = (await call(who, "POST", "/songbooks", { name, kind: "SIMPLE" })).body;
  for (const one of songs) await call(who, "POST", `/songbooks/${created.id}/entries`, { songVersionId: one.id });
  return created;
};

// Moved with its songs.
const a = await song(owner, `Give A ${stamp}`);
const b = await song(owner, `Give B ${stamp}`);
const moving = await book(owner, `Give move ${stamp}`, [a, b]);
let r = await call(member, "POST", `/songbooks/${moving.id}/give-to-team`, { teamId: team.id, songs: "move" });
check("only its owner gives it", r.status === 403 || r.status === 404, String(r.status));
const memberBook = await book(member, `Member's ${stamp}`, []);
r = await call(member, "POST", `/songbooks/${memberBook.id}/give-to-team`, { teamId: team.id, songs: "move" });
check("…to a team they run (a member shares it instead)", r.status === 403, String(r.status));
r = await call(owner, "POST", `/songbooks/${moving.id}/give-to-team`, { teamId: team.id, songs: "sideways" });
check("…saying what becomes of their songs", r.status === 400, String(r.status));
r = await call(owner, "POST", `/songbooks/${moving.id}/give-to-team`, { teamId: team.id, songs: "move" });
check("a team's admin gives their songbook to the team, with its songs", r.status === 200 && r.body.moved === 2 && r.body.shared === 0, JSON.stringify(r.body));
r = await call(member, "GET", `/songbooks/${moving.id}`);
check("…the team's songbook now, its members open it", r.status === 200 && r.body.ownerScope === "TEAM" && r.body.ownerTeamId === team.id && r.body.entries.length === 2, JSON.stringify({ s: r.status, scope: r.body.ownerScope }));
r = await call(member, "GET", `/song-versions/${a.id}`);
check("…and its songs are the team's", r.status === 200 && r.body.ownerScope === "TEAM" && r.body.ownerTeamId === team.id);
r = await call(owner, "POST", `/songbooks/${moving.id}/give-to-team`, { teamId: team.id, songs: "move" });
check("…once: a team's songbook isn't given again", r.status === 400, String(r.status));

// Kept songs, shared with the team.
const c = await song(owner, `Give C ${stamp}`);
const keeping = await book(owner, `Give keep ${stamp}`, [c]);
r = await call(owner, "POST", `/songbooks/${keeping.id}/give-to-team`, { teamId: team.id, songs: "share" });
check("or given with its songs kept, shared with the team", r.status === 200 && r.body.shared === 1, JSON.stringify(r.body));
r = await call(member, "GET", `/song-versions/${c.id}`);
check("…its members read them", r.status === 200 && r.body.sharedBy?.team?.id === team.id && r.body.canEdit === false, JSON.stringify(r.body.sharedBy));
r = await call(owner, "GET", `/song-versions/${c.id}`);
check("…and they're still its owner's", r.body.ownerScope === "USER" && r.body.canManage === true);

// Leaving a songbook shared with you.
sql(`insert into "Connection" (id, "requesterId", "addresseeEmail", "addresseeId", status, "respondedAt") values ('gc${stamp}', '${owner.id}', '${friend.email}', '${friend.id}', 'ACCEPTED', now())`);
const sharedBook = await book(owner, `Give shared ${stamp}`, [await song(owner, `Give D ${stamp}`)]);
await call(owner, "PUT", `/songbooks/${sharedBook.id}/shares/users/${friend.id}`, { canEdit: false });
r = await call(friend, "GET", `/songbooks/${sharedBook.id}`);
check("a songbook shared with someone says it's theirs to leave", r.status === 200 && r.body.sharedWithMe === true, JSON.stringify(r.body.sharedWithMe));
await call(owner, "PUT", `/songbooks/${sharedBook.id}/shares/teams/${team.id}`, { canEdit: false });
r = await call(member, "GET", `/songbooks/${sharedBook.id}`);
check("…not one shared with their team", r.status === 200 && r.body.sharedWithMe === false);
r = await call(friend, "DELETE", `/songbooks/${sharedBook.id}/shares/users/me`);
check("they leave it", r.status === 200, String(r.status));
r = await call(friend, "GET", `/songbooks/${sharedBook.id}`);
check("…and no longer see it", r.status === 403 || r.status === 404, String(r.status));

finish();
