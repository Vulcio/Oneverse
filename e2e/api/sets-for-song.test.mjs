// The sets a song could go in (issue #330): a song's Add to set, and dropping it on a set from the library.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const song = async (who, title, extra = {}) => (await call(who, "POST", "/song-versions", { artists: ["Test Artist"], title, language: "en", ...extra })).body;
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

const admin = await user("admin");
const member = await user("member");
const outsider = await user("outsider");

const team = (await call(admin, "POST", "/teams", { name: `For Song Team ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);

const personalSong = await song(admin, `For Song Personal ${stamp}`);
const teamSong = await song(admin, `For Song Team Song ${stamp}`, { teamId: team.id });

const soon = (await call(admin, "POST", "/setlists", { name: `Soon ${stamp}`, eventDate: isoDate(3) })).body;
const later = (await call(admin, "POST", "/setlists", { name: `Later ${stamp}`, eventDate: isoDate(10) })).body;
const undated = (await call(admin, "POST", "/setlists", { name: `Undated ${stamp}` })).body;
const past = (await call(admin, "POST", "/setlists", { name: `Past ${stamp}`, eventDate: isoDate(1) })).body;
sql(`update "Setlist" set "eventDate"='${isoDate(-3)}' where id='${past.id}'`);
const teamSet = (await call(admin, "POST", "/setlists", { name: `Team set ${stamp}`, eventDate: isoDate(5), teamId: team.id })).body;
await call(admin, "POST", `/setlists/${later.id}/items`, { songVersionId: personalSong.id });

let r = await call(admin, "GET", `/setlists/for-song/${personalSong.id}`);
const ids = r.body.map((set) => set.id);
check("upcoming sets soonest first, then undated, not past ones", r.status === 200 && ids.join() === [soon.id, teamSet.id, later.id, undated.id].join(), r.body.map((set) => set.name).join(" | "));
const byId = new Map(r.body.map((set) => [set.id, set]));
check("a set the song is in already says so", byId.get(later.id).hasSong === true && byId.get(soon.id).hasSong === false);
check("a team set takes one's own personal song (shared with the team as it's added, issue #331)", byId.get(teamSet.id).canAddSong === true && byId.get(soon.id).canAddSong === true, JSON.stringify(byId.get(teamSet.id)));
check("each is a set summary", byId.get(soon.id).name === `Soon ${stamp}` && byId.get(soon.id).canEdit === true && typeof byId.get(soon.id).itemCount === "number");

r = await call(admin, "GET", `/setlists/for-song/${teamSong.id}`);
check("the team's own song can go in the team's set", r.body.find((set) => set.id === teamSet.id)?.canAddSong === true);

// A member can't change the team's sets: none listed.
r = await call(member, "GET", `/setlists/for-song/${teamSong.id}`);
check("only sets one can change", r.status === 200 && !r.body.some((set) => set.id === teamSet.id), JSON.stringify(r.body.map((set) => set.id)));

// Someone else's personal song, shared with the admin: not theirs to share with the team.
const membersSong = await song(member, `For Song Member's ${stamp}`);
sql(`insert into "Connection" (id, "requesterId", "addresseeEmail", "addresseeId", status, "respondedAt") values ('cfs${stamp}', '${member.id}', '${admin.email}', '${admin.id}', 'ACCEPTED', now())`);
r = await call(member, "PUT", `/song-versions/${membersSong.id}/shares/${admin.id}`, { canEdit: true });
check("(shared with the admin)", r.status === 200, String(r.status));
r = await call(admin, "GET", `/setlists/for-song/${membersSong.id}`);
check("a team set doesn't take someone else's personal song", r.body.find((set) => set.id === teamSet.id)?.canAddSong === false && r.body.find((set) => set.id === soon.id)?.canAddSong === true, JSON.stringify(r.body.map((set) => [set.name, set.canAddSong])));

r = await call(outsider, "GET", `/setlists/for-song/${personalSong.id}`);
check("a song one can't see: 404", r.status === 404, String(r.status));

finish();
