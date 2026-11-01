// A songbook's songs and their details (issue #353): read in one list to
// edit in place; looked up again at the providers in one pass by the
// Worker (a song linked to song info by its link, one that isn't by a
// match with the same title and artist), then reviewed: what each would
// change, against the song as it is now, and only what's ticked written.
import { api, call, check, finish, stamp, user } from "../lib/harness.mjs";
import { startFakeProviders } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();
const owner = await user("Book keeper");
const stranger = await user("Stranger");
const wait = async (test, tries = 120) => {
  for (let i = 0; i < tries; i++) {
    const value = await test();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
};

const songbook = await api(owner, "POST", "/songbooks", { name: `Refresh ${stamp}`, kind: "NUMBERED", abbreviation: "RF" });
const a = await api(owner, "POST", "/song-versions", { title: `Oceans ${stamp}`, language: "en", artists: ["Hillsong"], year: 1999, key: "D" });
const b = await api(owner, "POST", "/song-versions", { title: `Nomatch ${stamp}`, language: "en", artists: ["Hillsong"] });
await api(owner, "POST", `/songbooks/${songbook.id}/entries`, { songVersionId: a.id, entryCode: "2" });
await api(owner, "POST", `/songbooks/${songbook.id}/entries`, { songVersionId: b.id, entryCode: "10" });

// --- the list
let r = await call(owner, "GET", `/songbooks/${songbook.id}/song-info`);
check("its songs with their details, in the book's order", r.status === 200 && r.body.map((s) => s.entryCode).join() === "2,10", `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
const row = r.body[0];
check("each with what it's known by", row.title === `Oceans ${stamp}` && row.artists.join() === "Hillsong" && row.year === 1999 && row.key === "D" && row.canEdit && typeof row.revision === "number", JSON.stringify(row));
check("someone who can't change the book can't read it here", (await call(stranger, "GET", `/songbooks/${songbook.id}/song-info`)).status === 403);

// --- a refresh
r = await call(owner, "POST", `/songbooks/${songbook.id}/song-info/refreshes`, {});
check("started", r.status === 201 && r.body.total === 2 && ["queued", "running", "done"].includes(r.body.status), `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
const refreshId = r.body.id;
const again = await api(owner, "POST", `/songbooks/${songbook.id}/song-info/refreshes`, {});
check("one at a time: asked again while it runs, the same one", again.id === refreshId || again.status === "done");
const done = await wait(async () => {
  const view = await api(owner, "GET", `/songbooks/${songbook.id}/song-info/refreshes/${refreshId}`);
  return view.status === "done" ? view : null;
});
check("done", !!done && done.done === 2, JSON.stringify(done).slice(0, 300));
const song = (id) => done.songs.find((s) => s.songVersionId === id);
check("a match for the song that has one", song(a.id)?.outcome === "found" && song(a.id).match?.album === "Album 1", JSON.stringify(song(a.id)).slice(0, 300));
check("none for the other", song(b.id)?.outcome === "no-close-match", JSON.stringify(song(b.id)));
const proposals = song(a.id).proposals;
const year = proposals.find((p) => p.field === "year");
check("what it would change: the year it has, not ticked", year?.current === 1999 && year.proposed === 2013 && !year.fillsEmpty, JSON.stringify(year));
check("and the album it doesn't have, ticked", proposals.find((p) => p.field === "album")?.fillsEmpty === true, JSON.stringify(proposals));
const latest = await api(owner, "GET", `/songbooks/${songbook.id}/song-info/refreshes/latest`);
check("the latest refresh, to come back to", latest.refresh?.id === refreshId);

// --- applied
check("nothing unknown", (await call(owner, "POST", `/songbooks/${songbook.id}/song-info/refreshes/${refreshId}/apply`, { songs: [{ songVersionId: a.id, fields: ["key"] }] })).status === 400);
r = await call(owner, "POST", `/songbooks/${songbook.id}/song-info/refreshes/${refreshId}/apply`, { songs: [{ songVersionId: a.id, fields: ["album", "tempo"] }, { songVersionId: b.id, fields: ["album"] }] });
check("applied what was ticked", r.status === 200 && r.body.applied[0]?.fields.join() === "album,tempo" && r.body.refused.join() === b.id, `${r.status} ${JSON.stringify(r.body)}`);
const after = await api(owner, "GET", `/song-versions/${a.id}`);
check("the album and tempo written, the year left as it was", after.album === "Album 1" && after.documentJson.defaults.tempo === 124 && after.year === 1999, `${after.album} ${after.documentJson.defaults.tempo} ${after.year}`);
check("and linked to its match", (await api(owner, "GET", `/song-versions/${a.id}/metadata`))?.album === "Album 1");
const view = await api(owner, "GET", `/songbooks/${songbook.id}/song-info/refreshes/${refreshId}`);
check("read again: what's written isn't offered any more", !view.songs.find((s) => s.songVersionId === a.id).proposals.some((p) => p.field === "album" || p.field === "tempo"));
check("a stranger can't apply", (await call(stranger, "POST", `/songbooks/${songbook.id}/song-info/refreshes/${refreshId}/apply`, { songs: [{ songVersionId: a.id, fields: ["year"] }] })).status === 403);

fake.close();
finish();
