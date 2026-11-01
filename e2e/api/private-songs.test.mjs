// "Private - only you can see it" (issue #172): a personal song nobody else
// sees is marked private for its owner, in lists and on its page; shared with
// someone, a team or an organisation, in a team's set or a shared one, sent to
// the catalogue, or a team's, it isn't.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const owner = await user("private owner");
const friend = await user("private friend");
const song = async (title, extra = {}) => (await call(owner, "POST", "/song-versions", { artists: ["Band"], title, language: "en", content: "[G]Hello\n", ...extra })).body;
const listed = async (id, who = owner) => (await call(who, "GET", `/song-versions?q=${encodeURIComponent(`Private ${stamp}`)}&pageSize=100`)).body.items.find((item) => item.id === id);
const page = async (id, who = owner) => (await call(who, "GET", `/song-versions/${id}`)).body;

const alone = await song(`Private ${stamp} alone`);
check("a new personal song is private, in the list", (await listed(alone.id))?.private === true, JSON.stringify(await listed(alone.id)));
check("…and on its page", (await page(alone.id)).private === true);

const toFriend = await song(`Private ${stamp} friend`);
sql(`insert into "Connection" (id, "requesterId", "addresseeEmail", "addresseeId", status, "respondedAt") values ('pc${stamp}', '${owner.id}', '${friend.email}', '${friend.id}', 'ACCEPTED', now())`);
await call(owner, "PUT", `/song-versions/${toFriend.id}/shares/${friend.id}`, { canEdit: false });
check("shared with someone: not private", (await listed(toFriend.id))?.private === false && (await page(toFriend.id)).private === false);
check("…and the person it's shared with isn't told it's private", (await page(toFriend.id, friend)).private !== true);

const team = (await call(owner, "POST", "/teams", { name: `Private team ${stamp}` })).body;
const toTeam = await song(`Private ${stamp} team share`);
await call(owner, "PUT", `/song-versions/${toTeam.id}/shares/teams/${team.id}`, { canEdit: false });
check("shared with a team: not private", (await listed(toTeam.id))?.private === false);

const inTeamSet = await song(`Private ${stamp} team set`);
const teamSet = (await call(owner, "POST", "/setlists", { name: `Private set ${stamp}`, teamId: team.id })).body;
sql(`insert into "SetlistItem" (id, "setlistId", "songVersionId", position, "sharedByUserId", "createdAt", "updatedAt") values ('psi${stamp}', '${teamSet.id}', '${inTeamSet.id}', 0, '${owner.id}', now(), now())`);
check("in a team's set: not private", (await listed(inTeamSet.id))?.private === false);

const inMySet = await song(`Private ${stamp} own set`);
const mySet = (await call(owner, "POST", "/setlists", { name: `My private set ${stamp}` })).body;
await call(owner, "POST", `/setlists/${mySet.id}/items`, { songVersionId: inMySet.id });
check("in one's own set: still private", (await listed(inMySet.id))?.private === true);
sql(`insert into "SetlistShareLink" (id, "setlistId", token) values ('psl${stamp}', '${mySet.id}', 'pst${stamp}')`);
check("…until the set is shared by link", (await listed(inMySet.id))?.private === false);

const teamSong = await song(`Private ${stamp} team's`, { teamId: team.id });
check("a team's song isn't private", (await listed(teamSong.id))?.private === false);

finish();
