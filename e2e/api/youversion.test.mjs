// YouVersion's Platform API as a Bible provider (issue #304): off without an
// App Key, the key in Admin > Bibles (encrypted, never shown back, tested),
// a language's versions, a passage with its version's copyright and no
// rights beyond reading it, never cached unless an admin allows it (issue
// #485), one request a chapter; in a set, its reference only, read live, on
// screens, never offline (issue #310) - against the suites' stand-in (lib/fake-providers.mjs), shaped as
// YouVersion's documentation describes.
import { API, api, call, check, finish, sql, user } from "../lib/harness.mjs";
import { startFakeProviders, youversionKey } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();
const reader = await user("Bible reader");
const admin = await user("Bible admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await api(admin, "DELETE", "/admin/scriptures/youversion");
Object.assign(youversionKey, { key: "yvp-e2e-app-key-0123456789", passages: 0 });

// --- off without a key
let providers = await api(reader, "GET", "/scriptures/providers");
check("without a key: YouVersion off", providers.youversion === false, JSON.stringify(providers));
let r = await call(reader, "GET", "/scriptures/youversion/bibles?language=en");
check("its versions say it isn't set up", r.status === 503 && /YouVersion isn't set up/.test(r.body.message), JSON.stringify(r.body));
r = await call(reader, "GET", `/scriptures/youversion/bibles/3034/passage?${new URLSearchParams({ reference: "John 3:16" })}`);
check("a passage too", r.status === 503, String(r.status));

// --- the key, in Admin > Bibles
check("only admins see it", (await call(reader, "GET", "/admin/scriptures/youversion")).status === 403);
check("only admins set it", (await call(reader, "PUT", "/admin/scriptures/youversion", { appKey: youversionKey.key })).status === 403);
check("a key has no spaces", (await call(admin, "PUT", "/admin/scriptures/youversion", { appKey: "not a key" })).status === 400);
let settings = await api(admin, "PUT", "/admin/scriptures/youversion", { appKey: youversionKey.key });
check("saved", settings.source === "database" && settings.hasDatabaseKey, JSON.stringify(settings));
check("never shown back", !JSON.stringify(await api(admin, "GET", "/admin/scriptures/youversion")).includes(youversionKey.key));
check("kept encrypted", !sql(`select "youversionAppKeyEnc" from "ScriptureSettings" where id='singleton'`).includes(youversionKey.key));
r = await call(admin, "POST", "/admin/scriptures/youversion/test");
check("its test works", r.body.ok === true && /2 English versions/.test(r.body.message), JSON.stringify(r.body));
providers = await api(reader, "GET", "/scriptures/providers");
check("now on, for anyone signed in", providers.youversion === true, JSON.stringify(providers));

// --- versions
r = await call(reader, "GET", "/scriptures/youversion/bibles?language=en");
check(
  "a language's versions, with their copyright",
  r.status === 200 && r.body.length === 2 && r.body[0].id === 3034 && r.body[0].abbreviation === "BSB" && /Berean/.test(r.body[0].copyright) && r.body[0].link === "https://www.bible.com/versions/3034",
  JSON.stringify(r.body).slice(0, 300),
);
r = await call(reader, "GET", "/scriptures/youversion/bibles?language=fr");
check("none in another: an empty list", r.status === 200 && r.body.length === 0, JSON.stringify(r.body));
r = await call(reader, "GET", "/scriptures/youversion/bibles?language=not a language");
check("a language is a tag", r.status === 400 && r.body.message.some((m) => /language must be a language tag/.test(m)), JSON.stringify(r.body));

// --- passages
const passage = (id, reference) => fetch(`${API}/scriptures/youversion/bibles/${id}/passage?${new URLSearchParams({ reference })}`, { headers: { Authorization: `Bearer ${reader.bearer}` } });
let res = await passage(3034, "Jean 3.16-18");
let body = await res.json();
check(
  "verses, each its own, with the version and its copyright",
  res.status === 200 && body.reference === "John 3:16-18" && body.parts.map((p) => p.id).join() === "JHN.3.16,JHN.3.17,JHN.3.18" && body.parts[0].text === "BSB text of John 3:16." && /Berean/.test(body.bible.copyright) && body.bible.attribution === body.bible.copyright,
  JSON.stringify(body).slice(0, 400),
);
check("on screens, never offline or exported", body.rights && body.rights.projection === true && !body.rights.offline && !body.rights.export, JSON.stringify(body.rights));
check("never cached", res.headers.get("cache-control") === "no-store", String(res.headers.get("cache-control")));
check("three verses of a chapter: one request (issue #485)", youversionKey.passages === 1, String(youversionKey.passages));
await passage(3034, "Jean 3.16-18");
check("not kept between requests by default", youversionKey.passages === 2, String(youversionKey.passages));
body = await (await passage(3034, "John 3")).json();
check("a whole chapter in one request, verse by verse", body.parts?.length === 36 && body.parts[15].id === "JHN.3.16" && youversionKey.passages === 3, JSON.stringify(body).slice(0, 300));
res = await passage(3034, "John");
check("a whole book is refused", res.status === 400, String(res.status));
res = await passage(3034, "Hezekiah 1:1");
check("a book that doesn't exist is refused", res.status === 400, String(res.status));
body = await (await passage(9001, "John 3:16")).json();
check("a version without a copyright line: its title and info instead", body.bible?.copyright === null && body.bible.attribution === "No Copyright Version. Public domain." && body.parts?.[0]?.text === "NOC text of John 3:16.", JSON.stringify(body).slice(0, 400));
res = await passage(4242, "John 3:16");
check("a version YouVersion doesn't have: 404", res.status === 404, String(res.status));

// --- in a set (issue #310): the reference and the version kept, the text read live
const set = await api(reader, "POST", "/setlists", { name: `YouVersion set ${Date.now()}` });
r = await call(reader, "POST", `/setlists/${set.id}/items`, { passage: { bibleId: "x", youversionId: 3034, reference: "John 3:16" } });
check("one of bibleId or youversionId, not both", r.status === 400, JSON.stringify(r.body));
r = await call(reader, "POST", `/setlists/${set.id}/items`, { passage: { youversionId: 4242, reference: "John 3:16" } });
check("a version YouVersion doesn't have: refused", r.status === 404, `${r.status} ${JSON.stringify(r.body)}`);
let asked = youversionKey.passages;
r = await call(reader, "POST", `/setlists/${set.id}/items`, { passage: { youversionId: 3034, reference: "Jn 3.16-17" } });
check("added without its text asked again (issue #485)", youversionKey.passages === asked, String(youversionKey.passages - asked));
const yvItem = r.body.items?.find((item) => item.kind === "PASSAGE");
check("a YouVersion passage goes into a set", r.status === 201 && yvItem?.passage?.youversionId === 3034 && yvItem.passage.reference === "John 3:16-17", `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
check("…only the reference and the version stored", Object.entries(JSON.parse(sql(`select passage from "SetlistItem" where id='${yvItem?.id}'`))).sort().join() === "reference,John 3:16-17,youversionId,3034");
const before = youversionKey.passages;
r = await call(reader, "GET", `/setlists/${set.id}/items/${yvItem.id}/song`);
check(
  "opened in the set: read from YouVersion, with its attribution and link",
  r.status === 200 && r.body.passage.chapters[0]?.verses.map((v) => v.text).join(" ") === "BSB text of John 3:16. BSB text of John 3:17." && /Berean/.test(r.body.passage.bible.copyright) && r.body.passage.link === "https://www.bible.com/versions/3034" && youversionKey.passages > before,
  JSON.stringify(r.body.passage).slice(0, 400),
);
const yvVerses = async (query = "") => {
  const copy = (await call(reader, "GET", `/setlists/${set.id}/offline${query}`)).body;
  return copy.songs.find((view) => view.item.id === yvItem.id)?.passage?.chapters.length ?? -1;
};
// Its licence is settled with YouVersion, not in Oneverse: no switch per version.
check("the screens' copy reads it", (await yvVerses("?for=screens")) === 1);
check("…never the offline copy", (await yvVerses()) === 0);
r = await call(reader, "GET", `/setlists/${set.id}/offline?for=screens`);
check("…to be kept on a screen 0 seconds: YouVersion's answer said nothing", r.body.songs.find((view) => view.item.id === yvItem.id)?.passage?.keepSeconds === 0, JSON.stringify(r.body.songs.find((view) => view.item.id === yvItem.id)?.passage).slice(0, 300));

// --- a screen showing the set (issue #485): what it already has isn't asked again on each reload
async function anonymous(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const pairing = (await anonymous("POST", "/screens/pairings")).body;
await api(reader, "POST", `/screens/pairings/${pairing.code}/confirm`, { name: `YouVersion screen ${Date.now()}`, mode: "LYRICS", setlistId: set.id });
const screenToken = (await anonymous("POST", `/screens/pairings/${pairing.pairingId}/claim`, { secret: pairing.secret })).body.token;
const shown = async (held) => {
  const query = held ? `?${new URLSearchParams({ held })}` : "";
  return (await anonymous("GET", `/screens/current${query}`, null, { Authorization: `Screen ${screenToken}` })).body.set.songs.find((view) => view.item.id === yvItem.id).passage;
};
asked = youversionKey.passages;
let onScreen = await shown();
check("a screen loads the passage's verses", onScreen.chapters[0]?.verses.length === 2 && youversionKey.passages === asked + 1, `${youversionKey.passages - asked} ${JSON.stringify(onScreen).slice(0, 200)}`);
asked = youversionKey.passages;
onScreen = await shown(`3034:${yvItem.passage.reference}`);
check("…reloading with it held: not asked again, said held", onScreen.held === true && onScreen.chapters.length === 0 && youversionKey.passages === asked, `${youversionKey.passages - asked} ${JSON.stringify(onScreen).slice(0, 200)}`);
const looks = await call(reader, "GET", `/screens/looks?setlistId=${set.id}`);
check("the console's screen looks don't ask for the text", looks.status === 200 && youversionKey.passages === asked, `${looks.status} ${youversionKey.passages - asked}`);

// --- keeping passages (issue #485): as long as YouVersion's Cache-Control allows, unless an admin says never
settings = await api(admin, "GET", "/admin/scriptures/youversion");
check("kept as YouVersion allows by default", settings.cache === true && settings.cacheSource === "default", JSON.stringify(settings));
check("only admins set it", (await call(reader, "PUT", "/admin/scriptures/youversion", { cache: false })).status === 403);
check("yes or no only", (await call(admin, "PUT", "/admin/scriptures/youversion", { cache: 4 })).status === 400);
const reads = async (reference) => {
  const at = youversionKey.passages;
  await passage(3034, reference);
  await passage(3034, reference);
  return youversionKey.passages - at;
};
check("an answer without Cache-Control isn't kept: asked for each read", (await reads("John 3:22-23")) === 2);
youversionKey.cacheControl = "no-store";
check("…nor one saying no-store", (await reads("John 3:22-24")) === 2);
youversionKey.cacheControl = "private, max-age=600";
check("…nor a private one, on the server", (await reads("John 3:22-25")) === 2);
r = await call(reader, "GET", `/setlists/${set.id}/offline?for=screens`);
check("…but a screen keeps it as long as max-age says", r.body.songs.find((view) => view.item.id === yvItem.id)?.passage?.keepSeconds === 600, JSON.stringify(r.body.songs.find((view) => view.item.id === yvItem.id)?.passage).slice(0, 300));
youversionKey.cacheControl = "public, max-age=3600";
check("kept as long as max-age says: asked once for two reads", (await reads("John 3:20-21")) === 1);
let answers = await call(admin, "GET", "/admin/scriptures/youversion/answers");
check(
  "Admin lists YouVersion's last answers, newest first, with their Cache-Control and what it allows",
  answers.status === 200 && answers.body[0]?.asked.startsWith("/v1/bibles/3034/passages/JHN.3.20-21") && answers.body[0].cacheControl === "public, max-age=3600" && answers.body[0].shared === 3600 && answers.body[0].private === 3600 && answers.body.some((one) => one.cacheControl === "private, max-age=600" && one.shared === 0 && one.private === 600) && answers.body.some((one) => one.cacheControl === null && one.shared === null),
  JSON.stringify(answers.body?.slice?.(0, 2)),
);
check("…never the App Key", !JSON.stringify(answers.body).includes(youversionKey.key));
check("…for admins only", (await call(reader, "GET", "/admin/scriptures/youversion/answers")).status === 403);
youversionKey.cacheControl = null;
asked = youversionKey.passages;
await passage(3034, "John 3:20-21");
check("…read from what was kept, even once YouVersion says nothing more", youversionKey.passages === asked, String(youversionKey.passages - asked));
settings = await api(admin, "PUT", "/admin/scriptures/youversion", { cache: false });
check("turned off", settings.cache === false && settings.cacheSource === "database" && settings.hasDatabaseKey, JSON.stringify(settings));
asked = youversionKey.passages;
await passage(3034, "John 3:20-21");
check("…what was kept is gone: asked again", youversionKey.passages === asked + 1, String(youversionKey.passages - asked));
youversionKey.cacheControl = "public, max-age=3600";
check("…and nothing kept while off, whatever YouVersion says", (await reads("John 3:20-21")) === 2);
r = await call(reader, "GET", `/setlists/${set.id}/offline?for=screens`);
check("…nor on screens", r.body.songs.find((view) => view.item.id === yvItem.id)?.passage?.keepSeconds === 0);
youversionKey.cacheControl = null;
settings = await api(admin, "PUT", "/admin/scriptures/youversion", { cache: null });
check("null: back to the environment's (none here: kept)", settings.cache === true && settings.cacheSource === "default", JSON.stringify(settings));
await api(admin, "PUT", "/admin/scriptures/youversion", { cache: false });
await api(admin, "PUT", "/admin/scriptures/youversion", { cache: null });
check("no per-version switch left", (await call(admin, "PUT", "/admin/scriptures/youversion/versions/3034", { canProject: true })).status === 404);

// --- a refused key, a spent one, then back to the environment (none here)
await api(admin, "PUT", "/admin/scriptures/youversion", { appKey: "yvp-another-app-key-987654" });
r = await call(admin, "POST", "/admin/scriptures/youversion/test");
check("a refused key fails its test, saying so", r.body.ok === false && /refused the App Key/.test(r.body.message), JSON.stringify(r.body));
await api(admin, "PUT", "/admin/scriptures/youversion", { appKey: "spent-allowance-key" });
r = await call(reader, "GET", "/scriptures/youversion/bibles?language=en");
check("its allowance used up: said so", r.status === 503 && /allowance/.test(r.body.message), JSON.stringify(r.body));
settings = await api(admin, "DELETE", "/admin/scriptures/youversion");
check("reverted: no key, YouVersion off", settings.source === "none" && !settings.hasDatabaseKey, JSON.stringify(settings));

fake.close();
finish();
