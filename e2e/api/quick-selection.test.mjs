// The Quick selection (issue #334): songs gathered, then added to a set at once.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const song = async (who, title, extra = {}) => (await call(who, "POST", "/song-versions", { artists: ["Test Artist"], title, language: "en", ...extra })).body;

const me = await user("me");
const other = await user("other");
const team = (await call(me, "POST", "/teams", { name: `Quick Team ${stamp}` })).body;
const first = await song(me, `Quick First ${stamp}`);
const second = await song(me, `Quick Second ${stamp}`);
const teamSong = await song(me, `Quick Team Song ${stamp}`, { teamId: team.id });
const theirs = await song(other, `Quick Theirs ${stamp}`);

let r = await call(me, "GET", "/quick-selection");
check("empty to start with", r.status === 200 && r.body.songs.length === 0, JSON.stringify(r.body));
await call(me, "PUT", `/quick-selection/songs/${first.id}`);
await call(me, "PUT", `/quick-selection/songs/${teamSong.id}`);
r = await call(me, "PUT", `/quick-selection/songs/${second.id}`);
check("songs in the order they were gathered", r.body.songs.map((s) => s.id).join() === [first.id, teamSong.id, second.id].join(), r.body.songs.map((s) => s.title).join(" | "));
r = await call(me, "PUT", `/quick-selection/songs/${first.id}`);
check("a song put in twice is there once, where it was", r.body.songs.map((s) => s.id).join() === [first.id, teamSong.id, second.id].join());
r = await call(me, "PUT", `/quick-selection/songs/${theirs.id}`);
check("a song one can't see: refused", r.status === 403 || r.status === 404, String(r.status));
r = await call(other, "GET", "/quick-selection");
check("someone else's is their own", r.body.songs.length === 0);

// Into a personal set that has the second song already.
const set = (await call(me, "POST", "/setlists", { name: `Quick set ${stamp}` })).body;
await call(me, "POST", `/setlists/${set.id}/items`, { songVersionId: second.id });
r = await call(me, "POST", `/quick-selection/add-to/${set.id}`, {});
check(
  "added at the end, one already in the set skipped",
  r.status === 201 && r.body.added === 2 && r.body.set.items.map((i) => i.song.id).join() === [second.id, first.id, teamSong.id].join() && r.body.skipped.map((s) => `${s.reason}:${s.songVersionId}`).join() === `in-set:${second.id}`,
  JSON.stringify({ added: r.body.added, skipped: r.body.skipped }),
);
check("what's in the set leaves the selection", r.body.selection.songs.length === 0);

// A team set: the personal song can't go in; it stays.
await call(me, "PUT", `/quick-selection/songs/${first.id}`);
await call(me, "PUT", `/quick-selection/songs/${teamSong.id}`);
const teamSet = (await call(me, "POST", "/setlists", { name: `Quick team set ${stamp}`, teamId: team.id })).body;
r = await call(me, "POST", `/quick-selection/add-to/${teamSet.id}`, { keep: false });
check("a song that can't go in a team set stays in the selection", r.body.added === 1 && r.body.skipped[0]?.reason === "not-addable" && r.body.selection.songs.map((s) => s.id).join() === first.id, JSON.stringify(r.body.skipped));

// keep: the songs stay.
const another = (await call(me, "POST", "/setlists", { name: `Quick keep ${stamp}` })).body;
r = await call(me, "POST", `/quick-selection/add-to/${another.id}`, { keep: true });
check("keep: added, and still in the selection", r.body.added === 1 && r.body.selection.songs.length === 1);
r = await call(other, "POST", `/quick-selection/add-to/${another.id}`, {});
check("only into a set one can change", r.status === 404 || r.status === 403, String(r.status));

r = await call(me, "DELETE", `/quick-selection/songs/${first.id}`);
check("a song taken out", r.body.songs.length === 0);
await call(me, "PUT", `/quick-selection/songs/${second.id}`);
r = await call(me, "DELETE", "/quick-selection");
check("emptied", r.status === 200 && r.body.songs.length === 0);

// A song deleted: gone from it.
await call(me, "PUT", `/quick-selection/songs/${second.id}`);
sql(`delete from "SongVersion" where id='${second.id}'`);
r = await call(me, "GET", "/quick-selection");
check("a deleted song leaves it", r.body.songs.length === 0);

finish();
