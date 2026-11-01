// API-level checks for songbook catalogue files and editing (issue #8).
import { API, stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const song = async (who, title, extra = {}) => (await call(who, "POST", "/song-versions", { artists: ["Test Artist"], title, language: "en", ...extra })).body;
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);


const raw = async (who, method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${who.bearer}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  // fetch's text() drops a leading byte-order mark; keep it visible.
  return { status: res.status, headers: res.headers, bytes, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) };
};
const admin = await user("admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const reader = await user("reader");
const abbrA = `TA${stamp % 100000}`;
const catA = (await call(admin, "POST", "/songbook-catalogs", { name: `Catalogue A ${stamp}`, abbreviation: abbrA, language: "fr" })).body;
const catB = (await call(admin, "POST", "/songbook-catalogs", { name: `Catalogue B ${stamp}` })).body;
const importInto = (catalog, content, extra = {}) => call(admin, "POST", `/songbook-catalogs/${catalog.id}/entries/import`, { content, ...extra });
const entries = async (catalog) => (await call(admin, "GET", `/songbook-catalogs/${catalog.id}`)).body.entries;

// --- preview, import, re-import
const csv = [
  "No;Title;Author;Composer;BPM;Time;Key;Year;Tags;Scripture;Artist;Subtitle;CCLI;Copyright;Mystery",
  '10;À toi la gloire;Edmond Budry;G. F. Handel;96;4/4;D;1884;"résurrection; louange";1 Co 15:55;Choir;Thine be the glory;1234;© Public domain;x',
  "2;Grâce infinie;John Newton;;72;3/4;G;1779;grâce;Ep 2:8;;;;;",
  "3;;;;fast;;;;;;;;;;",
].join("\n");
let r = await importInto(catA, csv, { dryRun: true });
check("preview reports without saving", r.status === 200 && r.body.dryRun && !r.body.applied && r.body.created === 2 && r.body.problems.length === 1 && (await entries(catA)).length === 0, JSON.stringify(r.body).slice(0, 300));
check("preview lists the row's problems and unknown columns", /Title is required; Tempo must be a whole number/.test(r.body.problems[0].message) && r.body.problems[0].row === 4 && r.body.unknownColumns.join() === "Mystery", JSON.stringify(r.body.problems));
r = await importInto(catA, csv);
let list = await entries(catA);
const e10 = list.find((e) => e.entryCode === "10");
check("import saves the good rows, semicolon-separated, with aliases", r.body.applied && r.body.created === 2 && list.length === 2 && e10.lyricist === "Edmond Budry" && e10.tempo === 96 && e10.timeSignature === "4/4" && e10.tags.join("|") === "résurrection|louange" && e10.reference === "1 Co 15:55" && e10.year === 1884, JSON.stringify(e10));
check("entries come back in natural number order", list.map((e) => e.entryCode).join() === "2,10");
r = await importInto(catA, csv.split("\n").slice(0, 3).join("\n"));
check("re-importing the same file changes nothing", r.body.unchanged === 2 && r.body.created === 0 && r.body.updated === 0, JSON.stringify(r.body));
r = await importInto(catA, "Number,Tempo\n2,80\n");
list = await entries(catA);
check("a file with only some columns only changes those", r.body.updated === 1 && r.body.changes[0].fields.join() === "tempo" && list.find((e) => e.entryCode === "2").tempo === 80 && list.find((e) => e.entryCode === "2").lyricist === "John Newton");
r = await importInto(catA, "Number,Key\n2,\n");
check("an empty cell clears the field", r.body.updated === 1 && (await entries(catA)).find((e) => e.entryCode === "2").key === null);
r = await importInto(catA, "Number,Title\n1,New one\n");
check("merge adds without removing", r.body.created === 1 && (await entries(catA)).length === 3);
r = await importInto(catA, "Number,Title\n1,New one\n5,\n", { mode: "replace" });
check("replace mode refuses to save while the file has problems", !r.body.applied && r.body.deleted === 2 && (await entries(catA)).length === 3, JSON.stringify(r.body));
r = await importInto(catA, "Number\n1\n10\n", { mode: "replace", dryRun: true });
check("replace preview shows what would go", r.body.deleted === 1 && r.body.changes.some((c) => c.kind === "delete" && c.entryCode === "2") && !r.body.applied);
r = await importInto(catA, "Number,Number\n1,1\n");
check("a file with two Number columns is reported", r.body.problems.some((p) => p.row === null && /Two columns/.test(p.message)) && !r.body.applied || r.body.created + r.body.updated === 0, JSON.stringify(r.body.problems));
r = await importInto(catA, "Number,Title\n7,A\n7,B\n");
check("a number used twice in one file is a problem", r.body.created === 1 && r.body.problems.some((p) => p.row === 3 && /already used on row 2/.test(p.message)));
await call(admin, "DELETE", `/songbook-catalogs/${catA.id}/entries/${(await entries(catA)).find((e) => e.entryCode === "7").id}`);

// --- JSON import
r = await importInto(catA, JSON.stringify({ entries: [{ number: "20", title: "Json song", tags: ["a", "b"], tempo: "100", notes: "line1\nline2" }] }), { filename: "x.json" });
const j20 = (await entries(catA)).find((e) => e.entryCode === "20");
check("JSON import", r.body.format === "json" && r.body.created === 1 && j20.tempo === 100 && j20.tags.join() === "a,b" && j20.notes === "line1\nline2", JSON.stringify(j20));

// --- editing single entries
r = await call(admin, "PATCH", `/songbook-catalogs/${catA.id}/entries/${j20.id}`, { tempo: "fast" });
check("editing validates like import", r.status === 400 && /Tempo must be a whole number/.test(r.body.message), JSON.stringify(r.body));
r = await call(admin, "PATCH", `/songbook-catalogs/${catA.id}/entries/${j20.id}`, { entryCode: "10" });
check("renumbering onto a taken number is refused", r.status === 409, String(r.status));
r = await call(admin, "PATCH", `/songbook-catalogs/${catA.id}/entries/${j20.id}`, { title: "" });
check("title can't be cleared", r.status === 400);
r = await call(admin, "PATCH", `/songbook-catalogs/${catA.id}/entries/${j20.id}`, { album: "Live", tags: "x; y", tempo: null });
check("editing changes only the fields sent", r.status === 200 && r.body.album === "Live" && r.body.tags.join() === "x,y" && r.body.tempo === null && r.body.title === "Json song");
r = await call(admin, "POST", `/songbook-catalogs/${catA.id}/entries`, { entryCode: "10", title: "Dup" });
check("adding a taken number is refused", r.status === 409);

// --- export and round trips
r = await raw(admin, "GET", `/songbook-catalogs/${catA.id}/export?format=csv`);
check("CSV export", r.status === 200 && r.text.startsWith("﻿Number,Title,SortTitle") && /attachment; filename="ta\d+\.csv"/i.test(r.headers.get("content-disposition")) && r.headers.get("content-type").startsWith("text/csv"), `${r.headers.get("content-type")} ${[...r.bytes.slice(0, 3)]} ${r.text.slice(0, 20)}`);
const exportedCsv = r.text;
r = await importInto(catB, exportedCsv, { filename: "a.csv" });
const strip = (e) => { const { id, original, translations, ...rest } = e; return rest; };
const aEntries = (await entries(catA)).map(strip);
check("a CSV export imports into another catalogue identically", r.body.created === aEntries.length && JSON.stringify((await entries(catB)).map(strip)) === JSON.stringify(aEntries), JSON.stringify(r.body).slice(0, 200));
r = await raw(admin, "GET", `/songbook-catalogs/${catA.id}/export?format=json`);
const exportedJson = JSON.parse(r.text);
check("JSON export carries details and every key", exportedJson.format === "songverse-songbook-catalog" && exportedJson.catalog.abbreviation === abbrA && exportedJson.entries.length === aEntries.length && "sortTitle" in exportedJson.entries[0] && exportedJson.entries[0].sortTitle === null);
exportedJson.catalog.name = `From file ${stamp}`;
exportedJson.catalog.abbreviation = `TF${stamp % 100000}`;
r = await call(admin, "POST", "/songbook-catalogs/import", { content: JSON.stringify(exportedJson), filename: "a.json" });
const fromFile = r.body.catalog;
check("a new catalogue is created from a JSON file, with its entries", r.status === 201 && fromFile.name === `From file ${stamp}` && fromFile.language === "fr" && r.body.import.created === aEntries.length, JSON.stringify(r.body).slice(0, 200));
r = await call(admin, "POST", "/songbook-catalogs/import", { content: exportedCsv, filename: "a.csv" });
check("creating a catalogue from CSV is refused with an explanation", r.status === 400 && /Create the catalogue first/.test(r.body.message));
r = await raw(admin, "GET", `/songbook-catalogs/${catA.id}/export?format=xml`);
check("unknown export format is refused", r.status === 400);

// --- original song links
r = await importInto(catB, `Number,Title,OriginalSong\n100,Translated,${abbrA} 10\n101,Same book,2\n102,Missing,${abbrA} 999\n103,Free text,Some hymn\n`);
list = await entries(catB);
const byCode = (code) => list.find((e) => e.entryCode === code);
check("\"ABBR number\" links to the other catalogue's entry", byCode("100").original?.catalogId === catA.id && byCode("100").original.title === "À toi la gloire", JSON.stringify(byCode("100").original));
check("a bare number links within the same catalogue", byCode("101").original?.entryCode === "2" && byCode("101").original.catalogId === catB.id);
check("a reference to a missing entry or plain text stays as text", byCode("102").original === null && byCode("102").originalSong === `${abbrA} 999` && byCode("103").original === null);
await importInto(catA, "Number,Title\n999,Added later\n");
check("...and links once that entry exists", (await entries(catB)).find((e) => e.entryCode === "102").original?.title === "Added later");

// --- permissions
r = await call(reader, "GET", `/songbook-catalogs/${catA.id}`);
check("anyone signed in can read a catalogue", r.status === 200);
r = await raw(reader, "GET", `/songbook-catalogs/${catA.id}/export?format=csv`);
check("...and export it", r.status === 200);
r = await call(reader, "POST", `/songbook-catalogs/${catA.id}/entries/import`, { content: "Number,Title\n1,x\n" });
check("only global admins can import", r.status === 403, String(r.status));
r = await call(reader, "PATCH", `/songbook-catalogs/${catA.id}/entries/${j20.id}`, { album: "x" });
check("...or edit", r.status === 403);

// --- a big file
const big = ["Number,Title,Composer,Lyricist,Copyright,Notes"];
for (let i = 1; i <= 1500; i++) big.push(`${i},Song number ${i} with a reasonably long title,Composer ${i},Lyricist ${i},© ${1900 + (i % 100)} Some Publisher Ltd,${"Notes ".repeat(10)}`);
const bigCsv = big.join("\n");
const bigCat = (await call(admin, "POST", "/songbook-catalogs", { name: `Big ${stamp}` })).body;
const started = Date.now();
r = await importInto(bigCat, bigCsv);
check(`a ${Math.round(bigCsv.length / 1024)} KB, 1,500-row file imports`, r.status === 200 && r.body.created === 1500, `${r.status} ${Date.now() - started}ms`);
r = await importInto(bigCat, bigCsv, { dryRun: true });
check("...and re-previews as unchanged", r.body.unchanged === 1500, `${Date.now() - started}ms total`);

// --- carrying entry facts into a song
const songbook = (await call(admin, "POST", "/songbooks/import-from-catalog", { catalogId: catA.id })).body;
const pending = (await call(admin, "GET", `/songbooks/${songbook.id}`)).body.pendingEntries;
const pending10 = pending.find((p) => p.entryCode === "10");
r = await call(admin, "POST", `/songbooks/${songbook.id}/catalog-entries/${pending10.catalogEntryId ?? pending10.id}/materialize`);
const created = (await call(admin, "GET", `/song-versions/${r.body.songVersionId}`)).body;
const d = created.documentJson;
check(
  "a song created from an entry gets its facts",
  created.title === "À toi la gloire" && created.alternateTitle === "Thine be the glory" && created.ccli === "1234" && created.copyright === "© Public domain" && created.year === 1884 &&
    d.defaults.key === "D" && d.defaults.tempo === 96 && d.defaults.timeSignature?.numerator === 4 && d.defaults.timeSignature?.denominator === 4,
  JSON.stringify({ t: created.title, a: created.alternateTitle, c: created.ccli, d: d.defaults }),
);
const credits = (created.contributors ?? []).map((c) => `${c.source}:${[...c.roles].sort().join("+")}`).sort().join(" | ");
check("...and credits for artist, composer and lyricist", credits === "Choir:PERFORMER | Edmond Budry:LYRICIST | G. F. Handel:COMPOSER", credits);

finish();
