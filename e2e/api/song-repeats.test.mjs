// Repeated sections linked (issue #231): a song imported before repeats
// were read in keeps a chorus written out again - the same, a tone up,
// with a chord of its own, its end. Its editors see them and link them:
// each becomes a pass of the chorus, its label kept; arrangements and
// recordings' cue points follow; the song's history keeps the change.
// A file imported now gets them linked straight away. An admin links the
// same and transposed ones across the library, from Background jobs.
import { API, stamp, sql, check, user, call, api, finish } from "../lib/harness.mjs";

const owner = await user("repeats owner");
const other = await user("repeats other");
const chorus = (id, chords, label = null) => ({
  id,
  type: "chorus",
  label,
  lines: [
    { id: `${id}_a`, kind: "lyric", text: "Holy, holy", chords: [{ id: `${id}_1`, at: 0, raw: chords[0] }, { id: `${id}_2`, at: 7, raw: chords[1] }] },
    { id: `${id}_b`, kind: "lyric", text: "Lord God almighty", chords: [{ id: `${id}_3`, at: 0, raw: chords[2] }, { id: `${id}_4`, at: 9, raw: chords[3] }] },
    { id: `${id}_c`, kind: "lyric", text: "Early in the morning", chords: [{ id: `${id}_5`, at: 0, raw: chords[4] }, { id: `${id}_6`, at: 13, raw: chords[5] }] },
  ],
});
const sections = [
  { id: `v${stamp}`, type: "verse", label: null, lines: [{ id: `v${stamp}_a`, kind: "lyric", text: "Morning has broken", chords: [{ id: `v${stamp}_1`, at: 0, raw: "G" }] }] },
  chorus(`c1${stamp}`, ["G", "D", "Em", "C", "G", "D"]),
  chorus(`c2${stamp}`, ["G", "D", "Em", "Am", "G", "D"], "Chorus 2"),
  chorus(`c3${stamp}`, ["A", "E", "F#m", "D", "A", "E"], "Last chorus"),
];
const song = await api(owner, "POST", "/song-versions", { title: `Repeats ${stamp}`, language: "en", artists: ["Band"], key: "G" });
let r = await call(owner, "PATCH", `/song-versions/${song.id}`, { sections, flow: sections.map((s, i) => ({ id: `f${i}${stamp}`, sectionId: s.id })) });
const saved = r.body.documentJson;

r = await call(other, "GET", `/song-versions/${song.id}/repeats`);
check("only its editors look for repeats", r.status === 403 || r.status === 404, String(r.status));
r = await call(owner, "GET", `/song-versions/${song.id}/repeats`);
const found = r.body.repeats;
check(
  "its repeats: one chord of its own, a tone up",
  r.status === 200 && found.length === 2 && found[0].kind === "chords" && found[0].chords === 1 && found[1].kind === "transposed" && found[1].steps === 2 && found.every((one) => one.ofSectionId === `c1${stamp}`),
  JSON.stringify(r.body),
);

// An arrangement singing the last chorus, and a recording cued on it.
const arrangement = (await call(owner, "POST", `/song-versions/${song.id}/arrangements`, { name: "Band" })).body;
const form = new FormData();
form.append("type", "AUDIO");
form.append("file", new Blob([Buffer.alloc(64)], { type: "audio/mpeg" }), "take.mp3");
const file = await (await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${owner.bearer}` }, body: form })).json();
await call(owner, "PATCH", `/song-versions/${song.id}/attachments/${file.id}`, { cuePoints: [{ at: 1, sectionId: `c1${stamp}` }, { at: 30, sectionId: `c3${stamp}` }] });

r = await call(owner, "POST", `/song-versions/${song.id}/repeats`, { revision: saved.revision - 1 });
check("on an older revision: refused", r.status === 409, String(r.status));
r = await call(owner, "POST", `/song-versions/${song.id}/repeats`, { revision: saved.revision, sectionIds: [`c3${stamp}`] });
check("one linked", r.status === 201 && r.body.linked === 1, JSON.stringify(r.body));
let doc = (await api(owner, "GET", `/song-versions/${song.id}`)).documentJson;
check(
  "the last chorus: a pass of the chorus, a tone up, its label kept",
  doc.sections.length === 3 && doc.flow[3].sectionId === `c1${stamp}` && doc.flow[3].transpose === 2 && doc.flow[3].label === "Last chorus",
  JSON.stringify(doc.flow),
);
const linkedArrangement = (await api(owner, "GET", `/arrangements/${arrangement.id}`)).document;
check("…its arrangement follows", linkedArrangement.items[3].sectionId === `c1${stamp}` && linkedArrangement.items[3].transpose === 2, JSON.stringify(linkedArrangement.items[3]));
const cued = (await api(owner, "GET", `/song-versions/${song.id}/attachments`)).find((one) => one.id === file.id);
check("…and the recording's cue points", JSON.stringify(cued?.cuePoints?.map((cue) => cue.sectionId)) === JSON.stringify([`c1${stamp}`, `c1${stamp}`]), JSON.stringify(cued?.cuePoints));

r = await call(owner, "POST", `/song-versions/${song.id}/repeats`, { revision: doc.revision });
doc = (await api(owner, "GET", `/song-versions/${song.id}`)).documentJson;
check(
  "the rest linked: Chorus 2 with its own chord, written over the chorus's",
  r.body.linked === 1 && doc.sections.length === 2 && doc.flow[2].label === "Chorus 2" && doc.flow[2].chords?.[0]?.chordId === `c1${stamp}_4` && doc.flow[2].chords[0].raw === "Am",
  JSON.stringify(doc.flow[2]),
);
check("nothing left to link", (await api(owner, "GET", `/song-versions/${song.id}/repeats`)).repeats.length === 0);
const history = await api(owner, "GET", `/song-versions/${song.id}/history`);
// Saves close together by the same person are one entry of the history.
check("kept in its history", history.length >= 2, String(history.length));

// --- a file imported now: linked straight away
const imported = await api(owner, "POST", "/song-versions", {
  title: `Imported ${stamp}`,
  language: "en",
  artists: ["Band"],
  content: "{key: G}\n{soc}\n[G]Holy, [D]holy\n[Em]Lord God [C]almighty\n{eoc}\n{soc}\n[A]Holy, [E]holy\n[F#m]Lord God [D]almighty\n{eoc}\n",
  contentFormat: "CHORDPRO",
});
const importedDoc = (await api(owner, "GET", `/song-versions/${imported.id}`)).documentJson;
check("imported: the chorus a tone up is a pass of the first", importedDoc.sections.length === 1 && importedDoc.flow[1]?.transpose === 2, JSON.stringify(importedDoc.flow));

// --- across the library: the same and transposed linked, the rest left to the song's editors
const library = await api(owner, "POST", "/song-versions", { title: `Library ${stamp}`, language: "en", artists: ["Band"], key: "G" });
const again = [chorus(`l1${stamp}`, ["G", "D", "Em", "C", "G", "D"]), chorus(`l2${stamp}`, ["G", "D", "Em", "C", "G", "D"]), chorus(`l3${stamp}`, ["G", "D", "Em", "Am", "G", "D"])];
await api(owner, "PATCH", `/song-versions/${library.id}`, { sections: again, flow: again.map((s, i) => ({ id: `lf${i}${stamp}`, sectionId: s.id })) });
r = await call(owner, "POST", "/admin/repeats/backfill", { apply: true });
check("only global admins run it", r.status === 403, String(r.status));
sql(`update "User" set "isGlobalAdmin"=true where id='${owner.id}'`);
r = await call(owner, "POST", "/admin/repeats/backfill", {});
check("counted first, without changing anything", r.status === 201 && r.body.queued, JSON.stringify(r.body));
const until = async (test) => {
  for (let i = 0; i < 100; i++) {
    if (await test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};
const counted = await until(async () => (await api(owner, "GET", "/admin/jobs")).recent.some((job) => job.name === "repeats-backfill" && job.result?.songs >= 1));
check("…its count among the jobs done", counted && (await api(owner, "GET", `/song-versions/${library.id}`)).documentJson.sections.length === 3);
await until(async () => (await call(owner, "POST", "/admin/repeats/backfill", { apply: true })).body.queued);
const linkedAll = await until(async () => (await api(owner, "GET", `/song-versions/${library.id}`)).documentJson.sections.length === 2);
const left = (await api(owner, "GET", `/song-versions/${library.id}/repeats`)).repeats;
check("linked: the same one; the one with a chord of its own left for its editors", linkedAll && left.length === 1 && left[0].kind === "chords", JSON.stringify(left));

finish();
