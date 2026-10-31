// Folding a song into its catalogue song (issue #75), as merging a duplicate
// at review does: one song left; its arrangements fit the catalogue song; how
// its owner had it is their arrangement of it; its files stay theirs; its
// set, pin and tags follow; its details become a suggestion. (Songs once
// published as copies, linked by an UpstreamLink, were folded the same way
// at startup until #347 dropped the table.)
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Fold admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("Fold alice");
const bob = await user("Fold bob");
const [globalTag] = sql(`select id from "Tag" where scope='GLOBAL' and "isApproved" limit 1`).split("\n");
const title = `Folded ${stamp}`;
const CHART = "{start_of_verse}\n[G]Amazing [G7]grace, how [C]sweet the [G]sound\nThat [G]saved a [Em]wretch like [D]me\n{end_of_verse}\n\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n";

// --- Alice's song, and a catalogue song with the same chart (same IDs)
const song = await api(alice, "POST", "/song-versions", { title, language: "en", artists: ["Alice Band"], key: "G", content: CHART, tagIds: [globalTag] });
const copy = await api(admin, "POST", "/song-versions", { title, language: "en", artists: ["Alice Band"], key: "G" });
sql(`update "SongVersion" s set "documentJson" = (select "documentJson" from "SongVersion" where id='${song.id}'), "ownerScope"='GLOBAL', "ownerUserId"=null, "publicationState"='APPROVED', "contributedByUserId"='${alice.id}' where s.id='${copy.id}'`);

// Alice's layer on her song: an arrangement, a file, a set, a pin, her notes.
let doc = (await api(alice, "GET", `/song-versions/${song.id}`)).documentJson;
const verse = doc.sections[0];
let arrangement = await api(alice, "POST", `/song-versions/${song.id}/arrangements`, { name: "Capo 2" });
const withChord = structuredClone(arrangement.document);
withChord.items[0].overrides = [{ type: "chord", chordId: verse.lines[0].chords[1].id, raw: "G/B" }];
arrangement = await api(alice, "PATCH", `/arrangements/${arrangement.id}`, { document: withChord, updatedAt: arrangement.updatedAt });
const form = new FormData();
form.append("type", "PDF");
form.append("visibility", "SONG");
form.append("file", new Blob([`%PDF-1.4 fold ${stamp}`], { type: "application/pdf" }), "lead.pdf");
await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${alice.bearer}` }, body: form });
const set = await api(alice, "POST", "/setlists", { name: `Fold set ${stamp}` });
await api(alice, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
await call(alice, "PUT", "/offline/pins", { kind: "SONG", targetId: song.id });
// The shape she chose for its G (issue #207).
await api(alice, "PUT", `/song-versions/${song.id}/chord-shapes`, { instrument: "guitar", tuning: "standard", chord: "G", frets: "355433" });
// Since then: Alice changed a line, added one and set the rights; an admin changed the catalogue chorus.
await api(alice, "PATCH", `/song-versions/${song.id}`, {
  content: CHART.replace("wretch like [D]me", "soul like [D]me").replace("[C]My chains are [G]gone", "[C]My chains are [G]gone\n[D]I've been set free"),
  notes: "Private rehearsal notes",
  copyright: "Public domain",
});
await api(admin, "PATCH", `/song-versions/${copy.id}`, { content: CHART.replace("[C]My chains", "[Am]My chains") });

// --- the fold
const sent = await api(alice, "POST", `/song-versions/${song.id}/submissions`, { duplicateReason: "The same song" });
let r = await call(alice, "POST", `/submissions/${sent.id}/merge`, { targetId: copy.id });
check("only reviewers merge it", r.status === 403, String(r.status));
r = await call(admin, "POST", `/submissions/${sent.id}/merge`, { targetId: copy.id });
check("merged into the catalogue song", r.status === 201 && r.body.state === "APPROVED", JSON.stringify(r.body).slice(0, 200));
check("Alice's copy is gone", (await call(alice, "GET", `/song-versions/${song.id}`)).status === 404);
const listed = (await api(alice, "GET", `/song-versions?q=${encodeURIComponent(title)}`)).items;
check("her library lists the song once, the catalogue one", listed.length === 1 && listed[0].id === copy.id, JSON.stringify(listed.map((s) => s.id)));

const arrangements = await api(alice, "GET", `/song-versions/${copy.id}/arrangements`);
const moved = await api(alice, "GET", `/arrangements/${arrangement.id}`);
check(
  "her arrangement is on the catalogue song, fitting it, for her to review",
  moved.songVersionId === copy.id && moved.problems.length === 0 && moved.needsReview === true && moved.document.items[0].overrides[0].raw === "G/B",
  JSON.stringify({ song: moved.songVersionId, problems: moved.problems, review: moved.needsReview }),
);
const own = arrangements.find((a) => a.id !== arrangement.id);
check("how she had it is her arrangement of it, named for her, with her notes", own?.name === "Fold alice's" && own.ownerName === "Fold alice", JSON.stringify(arrangements.map((a) => a.name)));
const ownDetail = await api(alice, "GET", `/arrangements/${own.id}`);
const overrides = ownDetail.document.items.flatMap((item) => item.overrides);
check(
  "it plays her lines: the changed one, the added one",
  ownDetail.description === "Private rehearsal notes" &&
    ownDetail.problems.length === 0 &&
    overrides.some((o) => o.type === "lyric" && o.text === "That saved a soul like me") &&
    overrides.some((o) => o.type === "insert_line" && o.line.text === "I've been set free"),
  JSON.stringify({ problems: ownDetail.problems, overrides }),
);
check("her notes stayed private", (await api(bob, "GET", `/song-versions/${copy.id}`)).notes === null);
check("nobody else sees her arrangement", (await api(bob, "GET", `/song-versions/${copy.id}/arrangements`)).length === 0);

const files = await api(alice, "GET", `/song-versions/${copy.id}/attachments`);
check("her file is on it, still only hers", files.length === 1 && files[0].filename === "lead.pdf" && files[0].visibility === "PRIVATE", JSON.stringify(files));
check("nobody else sees it", (await api(bob, "GET", `/song-versions/${copy.id}/attachments`)).length === 0);
const item = (await api(alice, "GET", `/setlists/${set.id}`)).items[0];
check("her set plays the catalogue song, her way", item.song.id === copy.id && item.arrangement?.id === own.id, JSON.stringify(item));
check("her pin follows", (await api(alice, "GET", "/offline/pins")).some((pin) => pin.targetId === copy.id));
check("her chosen chord shape follows", (await api(alice, "GET", `/song-versions/${copy.id}/chord-shapes`)).some((choice) => choice.chord === "G" && choice.frets === "355433"));
check("its tag too", (await api(alice, "GET", `/song-versions/${copy.id}`)).tags.some((t) => t.id === globalTag));
const suggestion = (await api(alice, "GET", `/song-versions/${copy.id}/suggestions`))[0];
check("her details are suggested to the reviewers", suggestion?.state === "OPEN" && suggestion.changes.join() === "details", JSON.stringify(suggestion));
check("the catalogue chorus keeps the admin's change", (await api(bob, "GET", `/song-versions/${copy.id}`)).documentJson.sections[1].lines[0].chords[0].raw === "Am");

// --- merging a duplicate at review folds it too
const catalogue = await api(admin, "POST", "/song-versions", { title: `Merge ${stamp}`, language: "en", artists: ["Band"], key: "G", content: CHART });
await api(admin, "POST", `/song-versions/${catalogue.id}/publish`, {});
const duplicate = await api(bob, "POST", "/song-versions", { title: `Merge ${stamp}`, language: "en", artists: ["Band"], key: "A", content: CHART.replace(/\[([^\]]+)\]/g, (_, c) => `[${{ G: "A", G7: "A7", C: "D", Em: "F#m", D: "E" }[c]}]`) });
const bobArrangement = await api(bob, "POST", `/song-versions/${duplicate.id}/arrangements`, { name: "Bob's band" });
const submission = await api(bob, "POST", `/song-versions/${duplicate.id}/submissions`, { duplicateReason: "Ours" });
r = await call(admin, "POST", `/submissions/${submission.id}/merge`, { targetId: catalogue.id });
check("merged", r.status === 201 && r.body.state === "APPROVED", JSON.stringify(r.body).slice(0, 200));
check("no second song: bob's is gone", (await call(bob, "GET", `/song-versions/${duplicate.id}`)).status === 404);
const bobs = await api(bob, "GET", `/song-versions/${catalogue.id}/arrangements`);
const bobMoved = await api(bob, "GET", `/arrangements/${bobArrangement.id}`);
check("his arrangement fits the catalogue song (matched by content)", bobMoved.songVersionId === catalogue.id && bobMoved.problems.length === 0, JSON.stringify(bobMoved.problems));
const bobOwn = bobs.find((a) => a.id !== bobArrangement.id);
check("his way of singing it - a tone up - is his arrangement", bobOwn?.transposeSteps === 2 && bobOwn.key === "A", JSON.stringify(bobs));
check("his submission is on the catalogue song", (await api(bob, "GET", "/submissions/mine")).some((s) => s.id === submission.id && s.song.id === catalogue.id));

finish();
