// API-level checks for notes on songs (issue #256): where a note is saved decides who sees it; anchors follow edits; replies, moderation, notifications.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const song = async (who, title, extra = {}) => (await call(who, "POST", "/song-versions", { artists: ["Test Artist"], title, language: "en", ...extra })).body;
const notes = async (who, songId, query = "") => call(who, "GET", `/song-versions/${songId}/notes${query}`);
const ids = (r) => (r.body?.notes ?? []).map((n) => n.id);

const owner = await user("owner");
const member = await user("member");
const leader = await user("leader");
const reader = await user("reader");
const guest = await user("guest");
const outsider = await user("outsider");

const team = (await call(owner, "POST", "/teams", { name: `Notes Team ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('ntm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now()), ('ntl${stamp}', '${team.id}', '${leader.id}', 'ADMIN', now(), now())`);

const tune = await song(owner, `Notes Song ${stamp}`, { teamId: team.id });
await call(owner, "PATCH", `/song-versions/${tune.id}`, { contentFormat: "CHORDPRO", content: "{start_of_verse}\n[G]Amazing [G7]grace how [C]sweet\nThat saved a wretch\n{end_of_verse}\n{start_of_chorus}\n[D]I once was lost\n{end_of_chorus}\n{chorus}\n" });
const doc = () => JSON.parse(sql(`select "documentJson" from "SongVersion" where id='${tune.id}'`));
let document = doc();
const verse = document.sections[0];
const chorus = document.sections[1];
const [line1] = verse.lines;
const g7 = line1.chords[1];
const chorusPasses = document.flow.filter((pass) => pass.sectionId === chorus.id);
check("the song has a verse, a chorus sung twice", verse && chorus && chorusPasses.length === 2 && g7?.raw === "G7", JSON.stringify(document.flow));

// A songbook of the team's, shared with a reader; a set of the team's, with a guest.
const book = (await call(owner, "POST", "/songbooks", { name: `Notes Book ${stamp}`, kind: "SIMPLE", language: "en", teamId: team.id })).body;
await call(owner, "POST", `/songbooks/${book.id}/entries`, { songVersionId: tune.id });
// Sharing is with one's people: the owner and the reader connect first.
await call(owner, "POST", "/people/requests", { email: reader.email });
const request = (await call(reader, "GET", "/users/me/notifications?limit=50")).body.items.find((item) => item.kind === "CONNECTION_REQUESTED");
await call(reader, "POST", `/people/requests/${request.data.connectionId}/accept`);
let r = await call(owner, "PUT", `/songbooks/${book.id}/shares/users/${reader.id}`, { canEdit: false });
check("the songbook is shared with a reader", r.status === 200, JSON.stringify(r.body));
const set = (await call(owner, "POST", "/setlists", { name: `Notes Set ${stamp}`, teamId: team.id })).body;
await call(owner, "POST", `/setlists/${set.id}/items`, { songVersionId: tune.id });
const token = (await call(owner, "POST", `/setlists/${set.id}/share-link`)).body.link.token;
await call(guest, "POST", `/set-invites/${token}/join`);

// --- where a new note may go
r = await notes(member, tune.id);
check("places: just me first, then the team and the songbook; not the song for a member", r.status === 200 && r.body.notes.length === 0 && r.body.places.map((p) => `${p.place}:${p.name ?? ""}`).join(",") === `ME:,TEAM:Notes Team ${stamp},SONGBOOK:Notes Book ${stamp}`, JSON.stringify(r.body.places));
r = await notes(member, tune.id, `?setlistId=${set.id}`);
check("opened in a set: the set first", r.body.places[0]?.place === "SET" && r.body.places[0].id === set.id && r.body.places[0].name === `Notes Set ${stamp}`, JSON.stringify(r.body.places));
r = await notes(member, tune.id, `?songbookId=${book.id}`);
check("opened from a songbook: the songbook first", r.body.places[0]?.place === "SONGBOOK" && r.body.places[0].id === book.id, JSON.stringify(r.body.places));
r = await notes(owner, tune.id);
check("an editor of the song may save in the song itself", r.body.places.at(-1)?.place === "SONG", JSON.stringify(r.body.places));
r = await notes(outsider, tune.id);
check("someone who can't see the song gets nothing", r.status === 404, String(r.status));

// --- one note in each place
const create = async (who, body) => call(who, "POST", "/notes", { songVersionId: tune.id, ...body });
r = await create(member, { content: "Capo 2 for me", place: "ME" });
const mine = r.body;
check("a note just for me", r.status === 201 && mine.place === "ME" && mine.anchor.kind === "song" && mine.author.id === member.id && mine.canEdit, JSON.stringify(r.body));
r = await create(member, { content: "Let ring", place: "TEAM", teamId: team.id, anchor: { kind: "chord", sectionId: verse.id, lineId: line1.id, chordId: g7.id } });
const teamNote = r.body;
check("a team note on a chord", r.status === 201 && teamNote.placeName === `Notes Team ${stamp}` && teamNote.anchor.chordId === g7.id, JSON.stringify(r.body));
r = await create(member, { content: "Big ending", place: "SONGBOOK", songbookId: book.id, anchor: { kind: "section", sectionId: chorus.id, passId: chorusPasses[1].id } });
const bookNote = r.body;
check("a songbook note on the chorus's second pass", r.status === 201 && bookNote.anchor.passId === chorusPasses[1].id, JSON.stringify(r.body));
r = await create(member, { content: "Drums out here", place: "SET", setlistId: set.id, anchor: { kind: "afterPass", passId: document.flow[0].id } });
const setNote = r.body;
check("a set note between sections", r.status === 201 && setNote.placeId === set.id, JSON.stringify(r.body));
r = await create(owner, { content: "Written in 1772", place: "SONG", anchor: { kind: "word", sectionId: verse.id, lineId: line1.id, at: 8 } });
const songNote = r.body;
check("the song's own note, on a word, by its editor", r.status === 201 && songNote.anchor.kind === "word" && songNote.anchor.at === 8, JSON.stringify(r.body));

// --- who may write where
r = await create(member, { content: "x", place: "SONG" });
check("a member can't write in the song itself", r.status === 403, String(r.status));
r = await create(reader, { content: "x", place: "TEAM", teamId: team.id });
check("someone outside the team can't write in it", r.status === 403, String(r.status));
r = await create(member, { content: "x", place: "SET", setlistId: set.id, teamId: team.id });
check("a note in a set with a team too is refused, by name", r.status === 400 && r.body.message.includes("teamId doesn't go with a note saved in a set"), JSON.stringify(r.body));
const other = await song(owner, `Not in the set ${stamp}`, { teamId: team.id });
r = await call(member, "POST", "/notes", { songVersionId: other.id, content: "x", place: "SET", setlistId: set.id });
check("a set note on a song the set doesn't have is refused", r.status === 400, JSON.stringify(r.body));
r = await create(reader, { content: "Reader was here", place: "SONGBOOK", songbookId: book.id });
check("someone the songbook is shared with writes in it", r.status === 201, JSON.stringify(r.body));
const readerNote = r.body;

// --- who sees what, where
r = await notes(member, tune.id);
check("the member sees their own, the team's, the songbook's and the song's - not the set's outside it", [mine.id, teamNote.id, bookNote.id, songNote.id, readerNote.id].every((id) => ids(r).includes(id)) && !ids(r).includes(setNote.id), ids(r).join(","));
r = await notes(member, tune.id, `?setlistId=${set.id}`);
check("…and the set's in the set", ids(r).includes(setNote.id));
r = await notes(leader, tune.id);
check("another member doesn't see someone's own note", !ids(r).includes(mine.id) && ids(r).includes(teamNote.id));
r = await notes(reader, tune.id);
check("the reader sees the songbook's and the song's, not the team's", ids(r).includes(bookNote.id) && ids(r).includes(songNote.id) && !ids(r).includes(teamNote.id), ids(r).join(","));
r = await notes(guest, tune.id, `?setlistId=${set.id}`);
check("a guest sees the set's and the song's, in the set", r.status === 200 && ids(r).includes(setNote.id) && ids(r).includes(songNote.id) && !ids(r).includes(teamNote.id) && !ids(r).includes(bookNote.id), ids(r).join(","));
r = await notes(guest, tune.id);
check("…and nothing outside it (the song isn't theirs)", r.status === 404, String(r.status));
r = await call(outsider, "POST", `/notes/${teamNote.id}/replies`, { content: "hi" });
check("someone who doesn't see a note can't reply", r.status === 404, String(r.status));

// --- replies and notifications
r = await call(leader, "POST", `/notes/${teamNote.id}/replies`, { content: "Agreed, and fade out" });
check("a member replies", r.status === 201 && r.body.replies.length === 1 && r.body.replies[0].author.id === leader.id, JSON.stringify(r.body));
const told = sql(`select data->>'note' || '|' || url from "Notification" where "userId"='${member.id}' and kind='NOTE_REPLY'`);
check("the note's author is told, with a link to the note", told === `Agreed, and fade out|/library/${tune.id}?note=${teamNote.id}`, told);
r = await call(owner, "POST", `/notes/${teamNote.id}/replies`, { content: "Fine by me" });
check("a second reply tells the author and the first replier, not the one replying", sql(`select count(*) from "Notification" where kind='NOTE_REPLY' and "userId" in ('${member.id}','${leader.id}')`) === "3" && sql(`select count(*) from "Notification" where kind='NOTE_REPLY' and "userId"='${owner.id}'`) === "0");
const ownerReply = r.body.replies[1];
r = await call(member, "PATCH", `/notes/${teamNote.id}/replies/${ownerReply.id}`, { content: "changed" });
check("a member can't edit someone else's reply", r.status === 403, String(r.status));
r = await call(guest, "POST", `/notes/${setNote.id}/replies`, { content: "Got it" });
check("a guest replies in the set; the link opens the song in the set", r.status === 201 && sql(`select url from "Notification" where "userId"='${member.id}' and data->>'note'='Got it'`).startsWith(`/sets/${set.id}/songs/`));

// --- moderation
r = await call(leader, "PATCH", `/notes/${teamNote.id}`, { content: "Let ring (edited)" });
check("a team admin edits a member's team note", r.status === 200 && r.body.content === "Let ring (edited)");
r = await call(leader, "PATCH", `/notes/${teamNote.id}/replies/${ownerReply.id}`, { content: "moderated" });
check("…and its replies", r.status === 200 && r.body.replies[1].content === "moderated");
r = await call(member, "PATCH", `/notes/${songNote.id}`, { content: "nope" });
check("a member can't change the song's note", r.status === 403, String(r.status));
r = await call(owner, "DELETE", `/notes/${readerNote.id}`);
check("the songbook's owner deletes a note written in it", r.status === 204);
r = await call(leader, "PATCH", `/notes/${setNote.id}`, { resolved: true });
check("a set's leader resolves a set note", r.status === 200 && r.body.resolved === true);
r = await call(reader, "DELETE", `/notes/${bookNote.id}`);
check("a reader can't delete someone's songbook note", r.status === 403, String(r.status));

// --- moved somewhere else as it's edited (issue #262): who sees it changes; its author only, under a new note's rules
r = await call(member, "PATCH", `/notes/${mine.id}`, { content: "Capo 2, everyone", place: "TEAM", teamId: team.id });
check("its author moves a note of their own to the team, words and all", r.status === 200 && r.body.place === "TEAM" && r.body.placeName === `Notes Team ${stamp}` && r.body.content === "Capo 2, everyone" && r.body.anchor.kind === "song", JSON.stringify(r.body));
check("…the team sees it now", ids(await notes(leader, tune.id)).includes(mine.id));
r = await call(leader, "PATCH", `/notes/${mine.id}`, { place: "ME" });
check("a team admin may edit it, not move it", r.status === 403, String(r.status));
r = await call(member, "PATCH", `/notes/${mine.id}`, { place: "SONG" });
check("not into the song itself for someone who isn't its editor", r.status === 403, String(r.status));
r = await call(member, "PATCH", `/notes/${mine.id}`, { place: "SET", setlistId: set.id, teamId: team.id });
check("a place with what doesn't go with it is refused, by name", r.status === 400 && r.body.message.includes("teamId doesn't go with a note saved in a set"), JSON.stringify(r.body));
r = await call(member, "PATCH", `/notes/${mine.id}`, { teamId: team.id });
check("a team without a place is refused", r.status === 400 && r.body.message.includes("teamId needs place, where the note is moved to"), JSON.stringify(r.body));
r = await call(member, "PATCH", `/notes/${mine.id}`, { place: "SET", setlistId: set.id });
check("moved into a set: seen only there", r.status === 200 && r.body.placeId === set.id && !ids(await notes(member, tune.id)).includes(mine.id) && ids(await notes(guest, tune.id, `?setlistId=${set.id}`)).includes(mine.id), JSON.stringify(r.body));
r = await call(member, "PATCH", `/notes/${mine.id}`, { content: "Capo 2 for me", place: "ME" });
check("…and back to just them: nobody else sees it", r.status === 200 && r.body.place === "ME" && r.body.placeId === null && !ids(await notes(leader, tune.id)).includes(mine.id), JSON.stringify(r.body));

// --- anchors through edits
await call(owner, "PATCH", `/song-versions/${tune.id}`, { contentFormat: "CHORDPRO", content: "{start_of_verse}\n[G]Amazing [G7]grace how [C]sweet the sound\nThat saved a wretch\n{end_of_verse}\n{start_of_chorus}\n[D]I once was lost\n{end_of_chorus}\n{chorus}\n" });
r = await notes(member, tune.id);
let pinned = r.body.notes.find((n) => n.id === teamNote.id);
check("a chord note stays on its chord through an edit of the line", pinned?.anchor.kind === "chord" && pinned.anchor.chordId === g7.id && pinned.moved === false, JSON.stringify(pinned));
await call(owner, "PATCH", `/song-versions/${tune.id}`, { contentFormat: "CHORDPRO", content: "{start_of_verse}\n[G]Amazing grace how [C]sweet the sound\nThat saved a wretch\n{end_of_verse}\n{start_of_chorus}\n[D]I once was lost\n{end_of_chorus}\n{chorus}\n" });
r = await notes(member, tune.id);
pinned = r.body.notes.find((n) => n.id === teamNote.id);
check("its chord deleted, it moves up to the line and says so", pinned?.anchor.kind === "line" && pinned.anchor.lineId === line1.id && pinned.moved === true, JSON.stringify(pinned));
pinned = r.body.notes.find((n) => n.id === bookNote.id);
check("a note on the chorus's second pass stays there", pinned?.anchor.kind === "section" && pinned.anchor.passId === chorusPasses[1].id && !pinned.moved, JSON.stringify(pinned));

// --- a song taken out of a songbook hides its notes, kept
await call(owner, "DELETE", `/songbooks/${book.id}/entries/${sql(`select id from "SongbookEntry" where "songbookId"='${book.id}' and "songVersionId"='${tune.id}'`)}`);
r = await notes(member, tune.id);
check("taken out of the songbook, its notes are hidden", !ids(r).includes(bookNote.id) && sql(`select count(*) from "Note" where id='${bookNote.id}'`) === "1");
await call(owner, "POST", `/songbooks/${book.id}/entries`, { songVersionId: tune.id });
r = await notes(member, tune.id);
check("…and back when it's put back", ids(r).includes(bookNote.id));

// --- offline copies carry them
r = await call(member, "GET", `/setlists/${set.id}/offline`);
check("a set's offline copy has the notes seen in it", r.status === 200 && r.body.notes?.[tune.id]?.notes.some((n) => n.id === setNote.id), JSON.stringify(Object.keys(r.body.notes ?? {})));
r = await call(member, "POST", "/offline/songs", { ids: [tune.id] });
check("a song's offline copy has the notes seen outside sets", r.status < 300 && r.body[0]?.notes.notes.some((n) => n.id === mine.id) && !r.body[0].notes.notes.some((n) => n.id === setNote.id), JSON.stringify(r.body[0]?.notes?.notes?.map((n) => n.id)));

// --- the Display setting
r = await call(member, "PATCH", "/users/me", { displaySettings: { LIVE: { notes: "MINE" } } });
check("each mode keeps whether it shows notes", r.status === 200 && (await call(member, "GET", "/users/me")).body.displaySettings?.LIVE?.notes === "MINE", JSON.stringify(r.body));

// --- deleting someone who wrote notes and replies
sql(`update "User" set "isGlobalAdmin"=true where id='${owner.id}'`);
r = await call(owner, "POST", `/admin/users/${leader.id}/delete`, { contentAction: "delete" });
check("deleting someone who wrote replies works", r.status === 201 && sql(`select count(*) from "NoteReply" where "authorUserId"='${leader.id}'`) === "0", JSON.stringify(r.body));
r = await notes(member, tune.id);
check("…their replies are gone, the note stays", r.body.notes.find((n) => n.id === teamNote.id)?.replies.every((reply) => reply.author.id !== leader.id));

finish();
