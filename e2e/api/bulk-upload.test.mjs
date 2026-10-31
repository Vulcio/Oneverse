// A songbook's bulk upload (issue #92 moved its processing to the Worker):
// the files are matched to entries by number and queued; the Worker parses
// each ChordPro file into its song's chart and keeps the file - even for a
// song with artwork, whose address the Worker (run without
// BETTER_AUTH_SECRET, as deployed) can't sign. The file is written as a
// French songbook writes them (issue #203): sections named in comments, the
// copyright and the site's address before them, numbered verses, the chorus
// written out each time, chords spelt the French way.
import { API, api, call, check, finish, stamp, user } from "../lib/harness.mjs";
import { startFakeProviders } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();

const me = await user("Uploader");
const songbook = await api(me, "POST", "/songbooks", { name: `Hymns ${stamp}`, kind: "NUMBERED", abbreviation: "HB" });
const song = await api(me, "POST", "/song-versions", { title: `Bulk ${stamp}`, language: "en", artists: ["Uploader"] });
await api(me, "POST", `/songbooks/${songbook.id}/entries`, { songVersionId: song.id, entryCode: "7" });
let hasImage = false;
for (let i = 0; i < 60 && !hasImage; i++) {
  hasImage = !!(await api(me, "GET", `/song-versions/${song.id}`)).imageUrl;
  if (!hasImage) await new Promise((resolve) => setTimeout(resolve, 250));
}
check("the song has its artwork first", hasImage);

const preview = await api(me, "POST", `/songbooks/${songbook.id}/bulk-upload/preview`, { filenames: ["7.cho", "99.cho"] });
check("matched by number", preview.find((m) => m.filename === "7.cho")?.status === "MATCHED" && preview.find((m) => m.filename === "99.cho")?.status !== "MATCHED", JSON.stringify(preview));
// Issue #201: a conflict names the other file; macOS's "._" copies and files of another kind are left out.
const clash = await api(me, "POST", `/songbooks/${songbook.id}/bulk-upload/preview`, { filenames: ["7.cho", "007 copy.cho", "._7.cho", "7.pdf"], type: "CHORDPRO" });
const row = (name) => clash.find((m) => m.filename === name);
check("a conflict says which file it's with", row("7.cho")?.status === "DUPLICATE" && JSON.stringify(row("7.cho")?.conflictsWith) === JSON.stringify(["007 copy.cho"]), JSON.stringify(clash));
check("a system file is left out", row("._7.cho")?.status === "IGNORED" && row("._7.cho")?.ignoredBecause === "hidden", JSON.stringify(row("._7.cho")));
check("so is a PDF when uploading ChordPro", row("7.pdf")?.status === "IGNORED" && row("7.pdf")?.ignoredBecause === "type", JSON.stringify(row("7.pdf")));

const form = new FormData();
form.append("type", "CHORDPRO");
const file = [
  `{t: Bulk ${stamp}}`,
  "{c: © 2020 Rolf Schneider}",
  "{c: https://www.example.org – HB7}",
  "{key: C}",
  "",
  "{c: Strophe 1}",
  "{start_of_verse}",
  `1. [G]Amazing [C7maj]grace ${stamp}`,
  "{end_of_verse}",
  "",
  "{c: Refrain}",
  "{start_of_chorus}",
  "[F]How [F#d]sweet",
  "{end_of_chorus}",
  "",
  "{c: Pont}",
  "{start_of_verse}",
  "[Am]That saved",
  "{end_of_verse}",
  "",
  "{c: Refrain}",
  "{start_of_chorus}",
  "[F]How [F#d]sweet",
  "{end_of_chorus}",
].join("\r\n");
form.append("files", new Blob([file], { type: "text/plain" }), "7.cho");
const res = await fetch(`${API}/songbooks/${songbook.id}/bulk-upload`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
const body = await res.json();
check("queued", res.status === 201, `${res.status} ${JSON.stringify(body)}`);

let chart = "";
let files = [];
for (let i = 0; i < 60; i++) {
  chart = JSON.stringify((await api(me, "GET", `/song-versions/${song.id}`)).documentJson);
  files = await api(me, "GET", `/song-versions/${song.id}/attachments`);
  if (chart.includes(`grace ${stamp}`) && files.length > 0) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
check("the Worker parsed it into the song's chart", chart.includes(`grace ${stamp}`), chart.slice(0, 200));
const read = await api(me, "GET", `/song-versions/${song.id}`);
const doc = read.documentJson;
check(
  // "Strophe 1" on the song's only verse says no more than its name would (issue #344): not kept, so it reads "Verse" in English.
  "the comments named the sections",
  JSON.stringify(doc.sections.map((s) => [s.type, s.label])) === JSON.stringify([["verse", null], ["chorus", null], ["bridge", null]]),
  JSON.stringify(doc.sections.map((s) => [s.type, s.label])),
);
check("the verse's number left out", doc.sections[0].lines[0].text === `Amazing grace ${stamp}`, doc.sections[0].lines[0].text);
check("the chorus written again is sung again", doc.flow.length === 4 && doc.flow[3].sectionId === doc.sections[1].id, JSON.stringify(doc.flow));
check("no notes from the header", doc.sections.every((s) => s.lines.every((l) => l.kind !== "note")) && doc.flow.every((i) => !i.note), JSON.stringify(doc.flow));
check("the key and copyright taken from the file", doc.defaults.key === "C" && read.copyright === "© 2020 Rolf Schneider", `${doc.defaults.key} ${read.copyright}`);
check("and kept the file", files.some((f) => f.filename === "7.cho"), JSON.stringify(files.map((f) => f.filename)));
check("only its owner uploads", (await call(await user("Other"), "POST", `/songbooks/${songbook.id}/bulk-upload/preview`, { filenames: ["7.cho"] })).status === 403);

fake.close();
finish();
