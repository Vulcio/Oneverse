// The bin (issue #340): deleting a song puts it in the bin for 30 days.
// Nobody sees it there - not in lists, by its link, in sets or songbooks -
// and its places come back when it's put back. Before deleting, its owner
// sees where others use it and can give it to the team instead. Global
// admins see people's private songs no more than anyone else.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const owner = await user("bin owner");
const member = await user("bin member");
const other = await user("bin other");
const admin = await user("bin admin");
sql(`update "User" set "isGlobalAdmin" = true where id = '${admin.id}'`);

const team = (await call(owner, "POST", "/teams", { name: `Bin team ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('binm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const song = async (who, title) => (await call(who, "POST", "/song-versions", { artists: ["Band"], title, language: "en", content: "[G]Hello [D]world\n" })).body;

// --- global admins and private songs
const secret = await song(owner, `Private ${stamp}`);
let r = await call(admin, "GET", `/song-versions/${secret.id}`);
check("a global admin doesn't open someone's private song by its link", r.status === 403 || r.status === 404, String(r.status));
r = await call(admin, "PATCH", `/song-versions/${secret.id}`, { title: "Changed" });
check("…nor change it", r.status === 403 || r.status === 404, String(r.status));
r = await call(admin, "GET", `/song-versions?q=${encodeURIComponent(`Private ${stamp}`)}`);
check("…nor find it in their library", r.status === 200 && !r.body.items.some((item) => item.id === secret.id));

// --- where it's used, before deleting
const used = await song(owner, `Used ${stamp}`);
const set = (await call(owner, "POST", "/setlists", { name: `Bin set ${stamp}`, teamId: team.id })).body;
r = await call(owner, "POST", `/setlists/${set.id}/items`, { songVersionId: used.id, teamAccess: "share" });
check("its owner shares their song into the team's set", r.status === 201, String(r.status));
r = await call(member, "GET", `/song-versions/${used.id}/usage`);
check("only who can delete it asks where it's used", r.status === 403, String(r.status));
r = await call(owner, "GET", `/song-versions/${used.id}/usage`);
check("its owner sees the team's set it's in", r.status === 200 && r.body.sets.some((one) => one.id === set.id && one.team?.id === team.id), JSON.stringify(r.body));
check("…and can give it to that team instead", r.body.teams?.some((one) => one.id === team.id), JSON.stringify(r.body.teams));

// --- into the bin
r = await call(owner, "DELETE", `/song-versions/${used.id}`);
check("deleting it puts it in the bin", r.status === 204, String(r.status));
r = await call(owner, "GET", `/song-versions/${used.id}`);
check("nobody opens it there, its owner neither", r.status === 404 || r.status === 403, String(r.status));
r = await call(owner, "GET", `/song-versions?q=${encodeURIComponent(`Used ${stamp}`)}`);
check("…nor finds it in the library", !r.body.items.some((item) => item.id === used.id));
r = await call(member, "GET", `/setlists/${set.id}`);
const item = r.body.items?.[0];
check("the team's set keeps its place, without the song", r.body.items?.length === 1 && !item?.song, JSON.stringify(item).slice(0, 200));
r = await call(owner, "GET", "/song-bin");
const binned = r.body.find((one) => one.id === used.id);
check("its owner finds it in their bin, with when it goes for good", !!binned && new Date(binned.purgeAt) - new Date(binned.deletedAt) === 30 * 864e5, JSON.stringify(binned));
r = await call(other, "GET", "/song-bin");
check("…which is nobody else's", r.status === 200 && !r.body.some((one) => one.id === used.id));
r = await call(other, "POST", `/song-bin/${used.id}/restore`);
check("someone else can't put it back", r.status === 403 || r.status === 404, String(r.status));

// --- back again
r = await call(owner, "POST", `/song-bin/${used.id}/restore`);
check("its owner puts it back", r.status === 204, String(r.status));
r = await call(member, "GET", `/setlists/${set.id}`);
check("…and it's in the team's set again", r.body.items?.[0]?.song?.id === used.id, JSON.stringify(r.body.items?.[0]).slice(0, 200));

// --- given to the team instead
r = await call(owner, "POST", `/song-versions/${used.id}/move-to-team`, { teamId: team.id });
check("its owner gives it to the team (as its admin, at once)", r.status === 201 && r.body.moved === true, JSON.stringify(r.body));
r = await call(member, "GET", `/song-versions/${used.id}`);
check("…and it's the team's now", r.status === 200 && r.body.ownerTeamId === team.id, String(r.body.ownerTeamId));

// --- deleted for good
const gone = await song(owner, `Gone ${stamp}`);
await call(owner, "DELETE", `/song-versions/${gone.id}`);
r = await call(other, "DELETE", `/song-bin/${gone.id}`);
check("only its owner deletes it for good", r.status === 403 || r.status === 404, String(r.status));
r = await call(owner, "DELETE", `/song-bin/${gone.id}`);
check("its owner deletes it for good", r.status === 204, String(r.status));
check("…and it's gone from the database", sql(`select count(*) from "SongVersion" where id = '${gone.id}'`) === "0");

// --- the Worker's purge after 30 days
const old = await song(owner, `Old ${stamp}`);
await call(owner, "DELETE", `/song-versions/${old.id}`);
sql(`update "SongVersion" set "deletedAt" = now() - interval '31 days' where id = '${old.id}'`);
r = await call(owner, "GET", "/song-bin");
check("a song binned 31 days ago is still listed until the Worker passes", r.body.some((one) => one.id === old.id));

finish();
