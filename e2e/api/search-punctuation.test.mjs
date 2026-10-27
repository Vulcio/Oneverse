// Song search ignores punctuation, hyphens and apostrophes as it ignores case
// and accents, finds misspelt words, and a set's Add songs searches the same
// way, songbook numbers too (issue #328).
import { api, call, check, finish, tag, user } from "../lib/harness.mjs";

const me = await user("Punctuation");
const eternel = await api(me, "POST", "/song-versions", { title: `Éternel ! Fais-moi connaître tes voies ${tag}`, language: "fr", artists: ["Someone"] });
const saint = await api(me, "POST", "/song-versions", { title: `Saint, saint saint ${tag}`, language: "fr", artists: ["Someone"] });
const grace = await api(me, "POST", "/song-versions", { title: `Amazing Grace ${tag}`, language: "en", artists: [`L'Équipe ${tag}`] });
const search = async (q, extra = "") => (await call(me, "GET", `/song-versions?q=${encodeURIComponent(q)}${extra}`)).body.items.map((song) => song.id);

for (const q of [`eternel fais moi connaitre tes voies ${tag}`, `éternel fais`, `éternel ! fais moi`, `Éternel, fais-moi`]) {
  check(`"${q}" finds "Éternel ! Fais-moi connaître tes voies"`, (await search(q)).includes(eternel.id));
}
check('"saint saint saint" finds "Saint, saint saint"', (await search(`saint saint saint ${tag}`)).includes(saint.id));
check("an apostrophe left out finds the artist", (await search(`lequipe ${tag}`)).includes(grace.id));
check("a misspelt word finds the song", (await search(`amazng grace ${tag}`)).includes(grace.id));
check("so does a misspelt French title", (await search(`eternel fai moi conaitre ${tag}`)).includes(eternel.id));
check("but not an unrelated song", !(await search(`amazng grace ${tag}`)).includes(saint.id));
let r = await call(me, "GET", `/song-versions?q=${encodeURIComponent("!?")}`);
check("only punctuation finds nothing by name", r.status === 200 && !r.body.items.some((song) => [eternel.id, saint.id, grace.id].includes(song.id)), String(r.status));

// A set's Add songs: the same search, and by songbook number.
const set = await api(me, "POST", "/setlists", { name: `Punctuation ${tag}` });
check("Add songs finds by the library's search", (await search(`éternel fais moi ${tag}`, `&addableTo=${set.id}`)).includes(eternel.id));
const book = await api(me, "POST", "/songbooks", { name: `Hymns ${tag}`, kind: "NUMBERED", abbreviation: "PNC" });
await api(me, "POST", `/songbooks/${book.id}/entries`, { songVersionId: saint.id, entryCode: "42" });
r = await call(me, "GET", `/songbook-entries?q=${encodeURIComponent("PNC 42")}&addableTo=${set.id}`);
check("and by songbook number", r.status === 200 && r.body.some((entry) => entry.songVersionId === saint.id), JSON.stringify(r.body).slice(0, 200));
// The set's own candidates, for clients that use them: the same matching.
r = await call(me, "GET", `/setlists/${set.id}/song-candidates?q=${encodeURIComponent(`saint saint saint ${tag}`)}`);
check("song-candidates ignore punctuation too", r.status === 200 && r.body.some((song) => song.id === saint.id), JSON.stringify(r.body).slice(0, 200));

finish();
