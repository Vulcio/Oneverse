// Arrangements (docs/arrangement-document-v2.md): who can make, see and
// change them, saving one, the team's usual one, playing one in a set, the
// song changing underneath, and a player's own chart preferences.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Arranging admin");
const member = await user("Band member");
const outsider = await user("Outsider");
const root = await user("Catalogue admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${root.id}'`);
const team = (await call(admin, "POST", "/teams", { name: `Arrangers ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tma${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);

// A global song nobody here can edit - arranging it is the main use.
let r = await call(admin, "POST", "/song-versions", {
  title: `Arranged ${stamp}`,
  language: "en",
  artists: ["Someone"],
  key: "G",
  capo: 3,
  content: "{start_of_verse}\n[G]Amazing grace how [D]sweet\n{end_of_verse}\n\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n",
  contentFormat: "CHORDPRO",
});
const songId = r.body.id;
sql(`update "SongVersion" set "ownerScope"='GLOBAL', "ownerUserId"=null, "publicationState"='APPROVED' where id='${songId}'`);
const song = (await call(member, "GET", `/song-versions/${songId}`)).body.documentJson;
const [verse, chorus] = song.sections;

// --- making one
r = await call(member, "POST", `/song-versions/${songId}/arrangements`, { name: "My acoustic" });
const mine = r.body;
check(
  "anyone who can see a song can arrange it; it starts as the song's order",
  r.status === 201 && mine.canEdit && mine.ownerScope === "USER" && mine.document.items.map((i) => i.sectionId).join() === song.flow.map((i) => i.sectionId).join() &&
    mine.document.songRevision === song.revision && mine.key === "G" && mine.problems.length === 0,
  JSON.stringify(r.body).slice(0, 400),
);
r = await call(member, "POST", `/song-versions/${songId}/arrangements`, { name: "Team band", teamId: team.id });
check("only a team's admins arrange for the team", r.status === 403, `${r.status}`);
r = await call(admin, "POST", `/song-versions/${songId}/arrangements`, { name: "Team band", teamId: team.id });
const teamArrangement = r.body;
check("a team admin makes a team arrangement", r.status === 201 && teamArrangement.ownerScope === "TEAM" && teamArrangement.teamName === team.name);

r = await call(member, "GET", `/song-versions/${songId}/arrangements`);
check("the song's arrangements: your own, then your teams'", r.status === 200 && r.body.map((a) => a.name).join() === "My acoustic,Team band", JSON.stringify(r.body.map((a) => a.name)));
check("a team member sees the team's but can't change it", r.body.find((a) => a.id === teamArrangement.id)?.canEdit === false);
r = await call(outsider, "GET", `/song-versions/${songId}/arrangements`);
check("others see none of them", r.status === 200 && r.body.length === 0);
check("nor open one", (await call(outsider, "GET", `/arrangements/${mine.id}`)).status === 403);

// --- saving one
const doc = structuredClone(mine.document);
doc.defaults = { ...doc.defaults, transposeSteps: 2, capo: 2, tempo: 90 };
doc.items[1].label = "Big chorus";
doc.items[1].overrides = [
  { type: "chord", chordId: chorus.lines[0].chords[1].id, raw: "Em" },
  { type: "hide_chord", chordId: chorus.lines[0].chords[0].id },
];
doc.items.push({ id: "ai_extra", sectionId: chorus.id, label: "Last chorus", keyChange: { steps: 1, key: "Bb" }, overrides: [], note: "All in" });
r = await call(member, "PATCH", `/arrangements/${mine.id}`, { document: doc, name: "My acoustic (A)", updatedAt: mine.updatedAt });
const saved = r.body;
check(
  "an arrangement saves its order, key, capo, tempo and overrides",
  r.status === 200 && saved.name === "My acoustic (A)" && saved.key === "A" && saved.capo === 2 && saved.document.items.length === 3 &&
    saved.document.items[1].overrides.length === 2 && saved.document.defaults.tempo === 90,
  `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`,
);
r = await call(member, "PATCH", `/arrangements/${mine.id}`, { name: "Stale", updatedAt: mine.updatedAt });
check("a save from before someone else's is refused", r.status === 409, `${r.status}`);
r = await call(member, "PATCH", `/arrangements/${mine.id}`, { document: { ...doc, items: [{ id: "x", sectionId: 5 }] } });
check("a document that isn't an arrangement is refused", r.status === 400 && /document\./.test(r.body.message), JSON.stringify(r.body));
r = await call(member, "PATCH", `/arrangements/${mine.id}`, { document: { ...doc, songVersionId: "sv_other" } });
check("so is one for another song", r.status === 400);
r = await call(member, "PATCH", `/arrangements/${teamArrangement.id}`, { name: "Mine now" });
check("a team member can't change the team's", r.status === 403);

// --- the team's usual one
r = await call(member, "PATCH", `/arrangements/${mine.id}`, { isTeamDefault: true });
check("only a team arrangement can be the team's usual one", r.status === 400);
const second = (await call(admin, "POST", `/song-versions/${songId}/arrangements`, { name: "Team acoustic", teamId: team.id, copyFromId: teamArrangement.id })).body;
await call(admin, "PATCH", `/arrangements/${teamArrangement.id}`, { isTeamDefault: true });
r = await call(admin, "PATCH", `/arrangements/${second.id}`, { isTeamDefault: true });
const defaults = (await call(admin, "GET", `/song-versions/${songId}/arrangements`)).body.filter((a) => a.isTeamDefault).map((a) => a.id);
check("one usual arrangement per team and song", r.status === 200 && defaults.join() === second.id, JSON.stringify(defaults));

// --- in sets
const teamSet = (await call(admin, "POST", "/setlists", { name: `Arr set ${stamp}`, teamId: team.id })).body;
r = await call(admin, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: songId });
let item = r.body.items[0];
check("a song added to a team set plays the team's usual arrangement", item.arrangement?.id === second.id, JSON.stringify(item.arrangement));
check("the set offers the team's arrangements of it", item.arrangements.map((a) => a.id).sort().join() === [teamArrangement.id, second.id].sort().join());
r = await call(admin, "PATCH", `/setlists/${teamSet.id}/items/${item.id}`, { arrangementId: mine.id });
check("a team set can't play someone's personal arrangement", r.status === 400, `${r.status}`);
r = await call(admin, "PATCH", `/setlists/${teamSet.id}/items/${item.id}`, { arrangementId: teamArrangement.id, transposeSteps: -1 });
item = r.body.items[0];
check("a set item switches arrangement, keeping its own key on top", r.status === 200 && item.arrangement.id === teamArrangement.id && item.transposeSteps === -1);
r = await call(member, "GET", `/setlists/${teamSet.id}/items/${item.id}/song`);
check(
  "the set's song view carries the arrangement, the song, the suggested capo and the player's view",
  r.status === 200 && r.body.arrangement?.id === teamArrangement.id && r.body.arrangement.document.items.length === 2 && r.body.song.document.revision === song.revision &&
    r.body.song.suggestedCapo === 3 && r.body.view.chordNotation === "LETTERS" && r.body.view.capoDisplayMode === "SOUNDING" && r.body.view.preferences.hiddenChordIds.length === 0,
  JSON.stringify(r.body).slice(0, 400),
);
r = await call(admin, "PATCH", `/setlists/${teamSet.id}/items/${item.id}`, { arrangementId: null });
check("or plays the song as written", r.body.items[0].arrangement === null);

// --- just for this set (issue #16: reorder, skip or repeat sections for one set)
await call(admin, "PATCH", `/setlists/${teamSet.id}/items/${item.id}`, { arrangementId: second.id });
r = await call(member, "POST", `/setlists/${teamSet.id}/items/${item.id}/set-arrangement`, { name: "Just for this set" });
check("only those who can change the set give a song its own arrangement for it", r.status === 403, `${r.status}`);
r = await call(admin, "POST", `/setlists/${teamSet.id}/items/${item.id}/set-arrangement`, { name: "Just for this set" });
const setOnlyId = r.body.arrangementId;
const setOnly = (await call(admin, "GET", `/arrangements/${setOnlyId}`)).body;
item = (await call(admin, "GET", `/setlists/${teamSet.id}`)).body.items[0];
check(
  "a song's own arrangement for a set starts as the one it played, is the team's and is played",
  r.status === 201 && item.arrangement?.id === setOnlyId && item.arrangement.setOnly === true && setOnly.setlistId === teamSet.id &&
    setOnly.teamId === team.id && setOnly.document.items.length === second.document.items.length && setOnly.document.items[0].id !== second.document.items[0].id,
  JSON.stringify({ status: r.status, arrangement: item.arrangement, setlistId: setOnly.setlistId }),
);
check("the set offers it among the song's arrangements", item.arrangements.some((a) => a.id === setOnlyId && a.setOnly) && item.arrangements.filter((a) => a.setOnly).length === 1);
r = await call(admin, "POST", `/setlists/${teamSet.id}/items/${item.id}/set-arrangement`, { name: "Again" });
check("asking again opens the same one", r.body.arrangementId === setOnlyId);
check("it isn't listed with the song's arrangements", !(await call(admin, "GET", `/song-versions/${songId}/arrangements`)).body.some((a) => a.id === setOnlyId));
r = await call(admin, "PATCH", `/arrangements/${setOnlyId}`, { isTeamDefault: true });
check("nor can it be the team's usual one", r.status === 400, `${r.status}`);
await call(admin, "PATCH", `/setlists/${teamSet.id}/items/${item.id}`, { arrangementId: second.id });
r = await call(admin, "PATCH", `/setlists/${teamSet.id}/items/${item.id}`, { arrangementId: setOnlyId });
check("the set can switch away from it and back", r.status === 200 && r.body.items[0].arrangement.id === setOnlyId);
const otherSet = (await call(admin, "POST", "/setlists", { name: `Other set ${stamp}` })).body;
const otherItem = (await call(admin, "POST", `/setlists/${otherSet.id}/items`, { songVersionId: songId })).body.items[0];
r = await call(admin, "PATCH", `/setlists/${otherSet.id}/items/${otherItem.id}`, { arrangementId: setOnlyId });
check("another set can't play it", r.status === 400, `${r.status}`);
const otherOwn = (await call(admin, "POST", `/setlists/${otherSet.id}/items/${otherItem.id}/set-arrangement`, { name: "Just for this set" })).body.arrangementId;
await call(admin, "PATCH", `/setlists/${otherSet.id}`, { teamId: team.id });
check("a set moving to a team takes its songs' own arrangements with it", sql(`select "ownerScope"||':'||coalesce("ownerTeamId",'') from "Arrangement" where id='${otherOwn}'`) === `TEAM:${team.id}`);
await call(admin, "DELETE", `/setlists/${otherSet.id}/items/${otherItem.id}`);
check("removing the song from the set removes its own arrangement", sql(`select count(*) from "Arrangement" where id='${otherOwn}'`) === "0");
await call(admin, "PATCH", `/setlists/${teamSet.id}/items/${item.id}`, { arrangementId: null });

// --- a player's own view
r = await call(member, "PUT", `/setlists/${teamSet.id}/items/${item.id}/chart-preferences`, { preferences: { hiddenChordIds: [verse.lines[0].chords[1].id], simplifyChords: true } });
check("a player hides a chord for themselves, through the set", r.status === 200 && r.body.hiddenChordIds.length === 1 && r.body.simplifyChords === true, JSON.stringify(r.body));
r = await call(member, "GET", `/setlists/${teamSet.id}/items/${item.id}/song`);
check("and sees it next time", r.body.view.preferences.hiddenChordIds[0] === verse.lines[0].chords[1].id);
r = await call(admin, "GET", `/setlists/${teamSet.id}/items/${item.id}/song`);
check("nobody else does", r.body.view.preferences.hiddenChordIds.length === 0);
r = await call(member, "PUT", "/chart-preferences", { songVersionId: songId, arrangementId: mine.id, preferences: { hideBassNotes: true } });
check("preferences are per arrangement", r.status === 200 && (await call(member, "GET", `/chart-preferences?songVersionId=${songId}&arrangementId=${mine.id}`)).body.hideBassNotes === true);
// How the song reads (issue #155): kept beside the rest, each saved on its own without losing the other.
await call(member, "PUT", `/setlists/${teamSet.id}/items/${item.id}/chart-preferences`, { preferences: { view: "PDF" } });
r = await call(member, "PUT", `/setlists/${teamSet.id}/items/${item.id}/chart-preferences`, { preferences: { hideBassNotes: true } });
check("the view chosen for a song is kept when the rest of the player's view is saved", r.body.view === "PDF" && r.body.simplifyChords === true && r.body.hideBassNotes === true, JSON.stringify(r.body));
r = await call(member, "PUT", "/chart-preferences", { songVersionId: songId, preferences: { view: "POSTER" } });
check("a view that doesn't exist is refused", r.status === 400, `${r.status}`);
r = await call(member, "PATCH", "/users/me", { liveView: "PDF" });
check("the player's default view, in their settings", r.status === 200 && r.body.liveView === "PDF", JSON.stringify(r.body.liveView));
r = await call(member, "GET", `/setlists/${teamSet.id}/items/${item.id}/song`);
check("and in a set song's view", r.body.view.liveView === "PDF", JSON.stringify(r.body.view));
r = await call(member, "PUT", "/chart-preferences", { songVersionId: songId, preferences: { hiddenChordIds: "all" } });
check("preferences that aren't preferences are refused", r.status === 400);
r = await call(outsider, "PUT", "/chart-preferences", { songVersionId: songId, arrangementId: mine.id, preferences: {} });
check("nor for an arrangement you can't see", r.status === 403, `${r.status}`);
r = await call(member, "PATCH", "/users/me", { chordNotation: "SOLFEGE", capoDisplayMode: "FINGERED" });
check("letters or solfège, sounding or capo shapes: the player's own settings", r.status === 200 && r.body.chordNotation === "SOLFEGE" && r.body.capoDisplayMode === "FINGERED");

// --- the song changes underneath
const edited = structuredClone(song.sections);
edited[1].lines[0].chords.splice(1, 1); // the chorus's G, replaced by "My acoustic"
r = await call(root, "PATCH", `/song-versions/${songId}`, { sections: edited });
check("(the song is changed by a global admin)", r.status === 200, `${r.status}`);
r = await call(member, "GET", `/arrangements/${mine.id}`);
check(
  "a changed song asks for a review, naming what no longer matches",
  r.body.needsReview === true && r.body.problems.length === 1 && /chord .* not found/.test(r.body.problems[0]),
  JSON.stringify({ needsReview: r.body.needsReview, problems: r.body.problems }),
);
r = await call(member, "POST", `/arrangements/${mine.id}/reviewed`);
check("marking it reviewed checks it against the song as it is", r.status === 201 && r.body.needsReview === false && r.body.document.songRevision === song.revision + 1, JSON.stringify(r.body).slice(0, 200));

// --- deleting
r = await call(admin, "DELETE", `/arrangements/${teamArrangement.id}`);
check("deleting an arrangement", r.status === 204 && (await call(admin, "GET", `/arrangements/${teamArrangement.id}`)).status === 404);
const mySong = (await call(member, "POST", "/song-versions", { title: `Mine ${stamp}`, language: "en", artists: ["Me"] })).body;
const onMine = (await call(member, "POST", `/song-versions/${mySong.id}/arrangements`, { name: "Short" })).body;
await call(member, "PUT", "/chart-preferences", { songVersionId: mySong.id, arrangementId: onMine.id, preferences: { simplifyChords: true } });
r = await call(member, "DELETE", `/song-versions/${mySong.id}`);
// In the bin first (issue #340), then deleted for good.
if (r.status === 204) r = await call(member, "DELETE", `/song-bin/${mySong.id}`);
check(
  "deleting a song (for good) takes its arrangements and preferences with it",
  r.status === 204 && sql(`select count(*) from "Arrangement" where id='${onMine.id}'`) === "0" && sql(`select count(*) from "ChartPreference" where "songVersionId"='${mySong.id}'`) === "0",
  `${r.status}`,
);

finish();
