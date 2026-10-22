// YouVersion's Platform API as a Bible provider (issue #304): off without an
// App Key, the key in Admin > Bibles (encrypted, never shown back, tested),
// a language's versions, a passage with its version's copyright and no
// rights beyond reading it, never cached; in a set, its reference only, read
// live, on screens once an admin allows the version, never offline (issue
// #310) - against the suites' stand-in (lib/fake-providers.mjs), shaped as
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
  "verses, one by one, with the version and its copyright",
  res.status === 200 && body.reference === "John 3:16-18" && body.parts.map((p) => p.id).join() === "JHN.3.16,JHN.3.17,JHN.3.18" && body.parts[0].text === "BSB text of John 3:16." && /Berean/.test(body.bible.copyright) && body.bible.attribution === body.bible.copyright,
  JSON.stringify(body).slice(0, 400),
);
check("on screens, never offline or exported", body.rights && body.rights.projection === true && !body.rights.offline && !body.rights.export, JSON.stringify(body.rights));
check("never cached", res.headers.get("cache-control") === "no-store", String(res.headers.get("cache-control")));
check("asked for afresh each time", youversionKey.passages === 3, String(youversionKey.passages));
await passage(3034, "John 3:16");
check("not kept between requests", youversionKey.passages === 4, String(youversionKey.passages));
body = await (await passage(3034, "John 3")).json();
check("a whole chapter in one piece", body.parts?.length === 1 && body.parts[0].id === "JHN.3", JSON.stringify(body).slice(0, 300));
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
r = await call(reader, "POST", `/setlists/${set.id}/items`, { passage: { youversionId: 3034, reference: "Jn 3.16-17" } });
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
