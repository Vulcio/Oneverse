// Artists with several names (issue #512): a global admin gives an artist
// other names (a former name, another spelling) and picks the one shown.
// Songs keep their credits; every name leads to the one artist - their page,
// the artists list, the library's artist filter, the search, the song's
// details kept offline. A name that was an artist of its own joins them.
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const owner = await user("Owner");
const admin = await user("Admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
// No lookups: this suite is about names, not pictures.
await api(admin, "PUT", "/admin/artists", { enabled: false });

const now = `Parfaitement ${stamp}`;
const former = `Hillsong Francais ${stamp}`;
const youth = `YouthFR ${stamp}`;
const spelling = `Hillsong FR ${stamp}`;
const detail = (who, name) => call(who, "GET", `/artists/detail?${new URLSearchParams({ name })}`);
const song = async (title, artist) => (await api(owner, "POST", "/song-versions", { title: `${title} ${stamp}`, language: "fr", artists: [artist] })).id;
const names = (who, body) => call(who, "PUT", "/artists/names", body);

const newSong = await song("Nouveau", now);
const oldSong = await song("Ancien", former);
const youthSong = await song("Jeunes", youth);
// The admin needs to see a song by them, as for a bio.
await api(admin, "POST", "/song-versions", { title: `Admin ${stamp}`, language: "fr", artists: [now] });
await api(admin, "POST", "/song-versions", { title: `Admin former ${stamp}`, language: "fr", artists: [former] });
// The former name has a page of its own already, with a bio written there.
check("a bio on the former name's page", (await call(admin, "PUT", "/artists/bio", { name: former, language: "fr", text: "Ancienne bio" })).status === 204);
const formerId = (await detail(admin, former)).body.id;

check("two artists before", (await detail(owner, former)).body.name === former && (await detail(owner, now)).body.songCount === 1);
check("only admins name artists", (await names(owner, { name: now, main: now, otherNames: [former] })).status === 403);

// --- the admin adds the other names
let r = await names(admin, { name: now, main: now, otherNames: [former, ` ${youth} `, spelling, former.toUpperCase(), ""] });
check("saved", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
check("the other names, each once", JSON.stringify([...r.body.otherNames].sort()) === JSON.stringify([former, spelling, youth].sort()), JSON.stringify(r.body.otherNames));
check("the former name's bio came along", r.body.bios.some((b) => b.language === "fr" && b.text === "Ancienne bio"), JSON.stringify(r.body.bios));
check("its own artist is gone", sql(`select count(*) from "Artist" where id='${formerId}'`) === "0");

// --- every name is one artist
let artist = (await detail(owner, former)).body;
check("the former name's page is theirs", artist.name === now && artist.songCount === 3 && artist.otherNames.length === 3, JSON.stringify(artist));
check("whatever the case or accents", (await detail(owner, youth.toLowerCase())).body.name === now);
let list = await api(owner, "GET", `/song-versions/artists?q=${encodeURIComponent(stamp)}`);
const mine = list.filter((entry) => [now, former, youth, spelling].includes(entry.name));
check("listed once, under the name shown, with every song", mine.length === 1 && mine[0].name === now && mine[0].songCount === 3, JSON.stringify(list));
list = await api(owner, "GET", `/song-versions/artists?q=${encodeURIComponent(spelling)}`);
check("found by a name no song credits", list.length === 1 && list[0].name === now, JSON.stringify(list));
let page = await api(owner, "GET", `/song-versions?artist=${encodeURIComponent(former)}&pageSize=50`);
check("the artist filter, by any name, has every song", page.total === 3 && [newSong, oldSong, youthSong].every((id) => page.items.some((item) => item.id === id)), JSON.stringify(page.items.map((i) => i.title)));
page = await api(owner, "GET", `/song-versions?q=${encodeURIComponent(`Parfaitement ${stamp}`)}&pageSize=50`);
check("searching the name shown finds the songs credited under the former ones", [newSong, oldSong, youthSong].every((id) => page.items.some((item) => item.id === id)), JSON.stringify(page.items.map((i) => i.title)));
page = await api(owner, "GET", `/song-versions?q=${encodeURIComponent(youth)}&pageSize=50`);
check("and a former name finds the new songs", page.items.some((item) => item.id === newSong), JSON.stringify(page.items.map((i) => i.title)));
const kept = await api(owner, "GET", `/song-versions/${oldSong}`);
check("songs keep their credit", kept.artists[0]?.source === former, JSON.stringify(kept.artists));
check("and carry the other names, for searching offline", [now, youth, spelling].every((name) => kept.artistOtherNames?.includes(name)) && !kept.artistOtherNames.includes(former), JSON.stringify(kept.artistOtherNames));

// --- a new song under a former name is theirs at once
const later = await song("Plus tard", spelling);
page = await api(owner, "GET", `/song-versions?q=${encodeURIComponent(`Parfaitement ${stamp}`)}&pageSize=50`);
check("a new song credited under another name is found by the name shown", page.items.some((item) => item.id === later));

// --- the name shown changes
r = await names(admin, { name: youth, main: former, otherNames: [now, youth, spelling] });
check("another name shown", r.status === 200 && r.body.name === former && r.body.otherNames.includes(now), JSON.stringify(r.body));
check("every page follows", (await detail(owner, now)).body.name === former);

// --- a name taken by another artist
const other = `Someone Else ${stamp}`;
await song("Autre", other);
await api(admin, "POST", "/song-versions", { title: `Admin other ${stamp}`, language: "fr", artists: [other] });
r = await names(admin, { name: other, main: other, otherNames: [youth] });
check("another artist's name is refused", r.status === 409 && /already another name/.test(r.body.message), `${r.status} ${JSON.stringify(r.body)}`);

// --- a name removed is an artist of its own again
r = await names(admin, { name: former, main: former, otherNames: [now, spelling] });
check("removed", r.status === 200 && !r.body.otherNames.includes(youth), JSON.stringify(r.body));
artist = (await detail(owner, youth)).body;
check("its songs are their own artist again", artist.name === youth && artist.songCount === 1 && artist.otherNames.length === 0, JSON.stringify(artist));
page = await api(owner, "GET", `/song-versions?q=${encodeURIComponent(youth)}&pageSize=50`);
check("and the search forgets the name", !page.items.some((item) => item.id === newSong), JSON.stringify(page.items.map((i) => i.title)));

await api(admin, "DELETE", "/admin/artists");
finish();
