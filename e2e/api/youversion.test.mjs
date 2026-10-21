// YouVersion's Platform API as a Bible provider (issue #304): off without an
// App Key, the key in Admin > Bibles (encrypted, never shown back, tested),
// a language's versions, a passage with its version's copyright and no
// rights beyond reading it, never cached - against the suites' stand-in
// (lib/fake-providers.mjs), shaped as YouVersion's documentation describes.
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
check("no rights beyond reading it", body.rights && !body.rights.offline && !body.rights.projection && !body.rights.export, JSON.stringify(body.rights));
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
