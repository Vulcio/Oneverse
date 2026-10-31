// API-level checks for Sets (issue #1): ownership, permissions, items, reorder, versions, transposition.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const song = async (who, title, extra = {}) => (await call(who, "POST", "/song-versions", { artists: ["Test Artist"], title, language: "en", ...extra })).body;
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

const admin = await user("admin");
const member = await user("member");
const outsider = await user("outsider");

const team = (await call(admin, "POST", "/teams", { name: `Sets Team ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);

const personalSong = await song(admin, `Personal Song ${stamp}`);
await call(admin, "PATCH", `/song-versions/${personalSong.id}`, { key: "G" });
const teamSong = await song(admin, `Team Song ${stamp}`, { teamId: team.id });
const globalSong = await song(admin, `Global Song ${stamp}`);
sql(`update "SongVersion" set "ownerScope"='GLOBAL', "ownerUserId"=null, "publicationState"='APPROVED' where id='${globalSong.id}'`);
// A second version of the global song's work, owned by the team.
const teamVersionOfGlobal = await song(admin, `Global Song ${stamp} (team arrangement)`, { teamId: team.id, workId: globalSong.workId });

// --- personal sets
let r = await call(admin, "POST", "/setlists", { eventDate: isoDate(7) });
const personalSet = r.body;
check("create a dated personal set without a name", r.status === 201 && personalSet.name === null && personalSet.eventDate === isoDate(7) && personalSet.teamId === null, JSON.stringify(personalSet));
r = await call(admin, "POST", "/setlists", { name: "Past", eventDate: isoDate(-5) });
check("a new set can't be dated in the past", r.status === 400, `${r.status} ${r.body?.message}`);
r = await call(admin, "POST", "/setlists", { eventDate: "2026-02-31" });
check("impossible dates rejected", r.status === 400, `${r.status} ${r.body?.message}`);
r = await call(admin, "POST", "/setlists", { name: "  Christmas Eve  " });
const undatedSet = r.body;
check("create an undated set with a custom (trimmed) name", r.status === 201 && undatedSet.name === "Christmas Eve" && undatedSet.eventDate === null);

// --- items
r = await call(admin, "POST", `/setlists/${personalSet.id}/items`, { songVersionId: personalSong.id, transposeSteps: 2 });
check("add a song with a transposition", r.status === 201 && r.body.items.length === 1 && r.body.items[0].transposeSteps === 2 && r.body.items[0].song.key === "G");
await call(admin, "POST", `/setlists/${personalSet.id}/items`, { songVersionId: teamSong.id });
r = await call(admin, "POST", `/setlists/${personalSet.id}/items`, { songVersionId: globalSong.id });
check("personal set accepts own, team and global songs", r.body.items.length === 3, r.body.items.map((i) => i.song?.title).join(" | "));
const [first, second, third] = r.body.items;

r = await call(admin, "PUT", `/setlists/${personalSet.id}/items/order`, { itemIds: [third.id, first.id, second.id] });
check("reorder items", r.status === 200 && r.body.items.map((i) => i.id).join() === [third.id, first.id, second.id].join() && r.body.items.every((item, i) => item.position === i));
r = await call(admin, "PUT", `/setlists/${personalSet.id}/items/order`, { itemIds: [third.id, first.id] });
check("reorder must list every item", r.status === 400, String(r.status));

const globalItem = r.status && (await call(admin, "GET", `/setlists/${personalSet.id}`)).body.items.find((i) => i.song.id === globalSong.id);
check("version picker lists both versions of a song", globalItem.versions.map((v) => v.id).sort().join() === [globalSong.id, teamVersionOfGlobal.id].sort().join(), globalItem.versions.map((v) => v.title).join(" | "));
r = await call(admin, "PATCH", `/setlists/${personalSet.id}/items/${globalItem.id}`, { songVersionId: teamVersionOfGlobal.id, transposeSteps: -3 });
const switched = r.body.items.find((i) => i.id === globalItem.id);
check("switch an item to another version and change its key", switched.song.id === teamVersionOfGlobal.id && switched.transposeSteps === -3);
r = await call(admin, "PATCH", `/setlists/${personalSet.id}/items/${globalItem.id}`, { songVersionId: personalSong.id });
check("can't switch to a different song via the version picker", r.status === 400, `${r.status} ${r.body?.message}`);

r = await call(admin, "DELETE", `/setlists/${personalSet.id}/items/${first.id}`);
check("remove an item, positions stay contiguous", r.body.items.length === 2 && r.body.items.every((item, i) => item.position === i));

r = await call(admin, "PATCH", `/setlists/${personalSet.id}`, { name: "Sunday service", eventDate: isoDate(-30) });
check("rename and re-date (past dates allowed once created)", r.body.name === "Sunday service" && r.body.eventDate === isoDate(-30));
r = await call(admin, "PATCH", `/setlists/${personalSet.id}`, { name: "", eventDate: null });
check("clearing the name and date", r.body.name === null && r.body.eventDate === null);

r = await call(outsider, "GET", `/setlists/${personalSet.id}`);
check("someone else's personal set is invisible", r.status === 404, String(r.status));

// --- team sets
r = await call(member, "POST", "/setlists", { name: "Nope", teamId: team.id });
check("team members (non-admin) can't create team sets", r.status === 403, String(r.status));
r = await call(admin, "POST", "/setlists", { name: "Team Sunday", eventDate: isoDate(3), teamId: team.id });
const teamSet = r.body;
check("team admin creates a team set", r.status === 201 && teamSet.teamId === team.id && teamSet.teamName === team.name);
r = await call(admin, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: personalSong.id });
check("team set asks before taking the admin's personal song (issue #331)", r.status === 409 && r.body?.code === "SONG_NOT_SHARED", r.body?.message);
await call(admin, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: teamSong.id });
r = await call(admin, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: globalSong.id, transposeSteps: 1 });
check("team set takes team and approved global songs", r.status === 201 && r.body.items.length === 2);

r = await call(admin, "GET", `/setlists/${teamSet.id}/song-candidates?q=${encodeURIComponent(`Song ${stamp}`)}`);
const candidateIds = r.body.map((s) => s.id);
// The admin's own personal songs too, shared with the team as they're added (issue #331).
check("team set candidates: the team's, approved global and the admin's own songs", candidateIds.includes(personalSong.id) && candidateIds.includes(teamSong.id) && candidateIds.includes(globalSong.id), r.body.map((s) => s.title).join(" | "));
// Add songs searches as the library does, for the songs that can go in the set (issue #328).
r = await call(admin, "GET", `/song-versions?q=${encodeURIComponent(`Song ${stamp}`)}&addableTo=${teamSet.id}`);
const addableIds = r.body.items?.map((s) => s.id) ?? [];
check("the library's search for a team set: the same", r.status === 200 && addableIds.includes(personalSong.id) && addableIds.includes(teamSong.id) && addableIds.includes(globalSong.id), JSON.stringify(r.body).slice(0, 200));
r = await call(member, "GET", `/song-versions?q=x&addableTo=${teamSet.id}`);
check("only the set's editors search for it", r.status === 403, String(r.status));

r = await call(member, "GET", `/setlists/${teamSet.id}`);
check("team member can view the team set, read-only", r.status === 200 && r.body.canEdit === false && r.body.items.every((i) => i.song !== null && i.versions.length === 0));
r = await call(member, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: teamSong.id });
check("team member can't edit it", r.status === 403, String(r.status));
r = await call(outsider, "GET", `/setlists/${teamSet.id}`);
check("non-member can't see the team set", r.status === 404, String(r.status));

r = await call(member, "GET", "/setlists");
check("member's list includes the team set", r.body.some((s) => s.id === teamSet.id && s.canEdit === false));
r = await call(admin, "GET", "/setlists");
const order = r.body.map((s) => s.id);
check("list order: upcoming first, then undated", order.indexOf(teamSet.id) < order.indexOf(undatedSet.id), r.body.map((s) => `${s.name ?? s.eventDate}`).join(" | "));

// A song that becomes invisible to a viewer shows as a placeholder.
sql(`update "SongVersion" set "ownerScope"='USER', "ownerUserId"='${admin.id}', "ownerTeamId"=null where id='${teamSong.id}'`);
r = await call(member, "GET", `/setlists/${teamSet.id}`);
check("song no longer visible to a viewer is hidden, not leaked", r.body.items.some((i) => i.song === null), r.body.items.map((i) => i.song?.title ?? "(hidden)").join(" | "));

// Deleting a song puts it in the bin (issue #340): the set keeps its place, without the song, until it's put back or deleted for good.
r = await call(admin, "DELETE", `/song-versions/${teamSong.id}`);
let after = (await call(admin, "GET", `/setlists/${teamSet.id}`)).body;
check("deleting a song keeps its place in sets, without it", (r.status === 204 || r.status === 200) && after.items.length === 2 && after.items.some((i) => i.song === null), `${r.status}, ${after.items.length} left`);
r = await call(admin, "DELETE", `/song-bin/${teamSong.id}`);
after = (await call(admin, "GET", `/setlists/${teamSet.id}`)).body;
check("…and deleting it for good removes it from sets", r.status === 204 && after.items.length === 1, `${r.status}, ${after.items.length} left`);

r = await call(admin, "DELETE", `/setlists/${teamSet.id}`);
check("delete a set", r.status === 204 && sql(`select count(*) from "Setlist" where id='${teamSet.id}'`) === "0" && sql(`select count(*) from "SetlistItem" where "setlistId"='${teamSet.id}'`) === "0");

finish();
