// A set's Bible passages (issue #301): an imported Bible and a reference,
// never a copy of the text. Its verses go where its Bible's rights allow:
// to whoever opens the set, to the screens only when it may be projected,
// into a device's offline copy only when it may be kept offline.
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { importBible } from "../lib/bibles.mjs";

const admin = await user("Passage admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const leader = await user("Passages");
const bible = await importBible(admin, `Passage Bible ${stamp}`, "PSG");

const song = (await call(leader, "POST", "/song-versions", { title: `Before the reading ${stamp}`, language: "en", artists: ["Band"], content: "{start_of_verse}\nOne line\n{end_of_verse}\n", contentFormat: "CHORDPRO" })).body;
const set = (await call(leader, "POST", "/setlists", { name: `Passages ${stamp}` })).body;
await call(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });

let r = await call(leader, "POST", `/setlists/${set.id}/items`, { passage: { bibleId: bible.id, reference: "Jn 3.16-17" } });
const item = r.body.items?.[1];
check(
  "add a passage: its reference as the Bible names the book, no verses in the set's list",
  r.status === 201 && item?.kind === "PASSAGE" && item.song === null && item.passage?.reference === "John 3:16-17" && item.passage.bible?.abbreviation === "PSG" && item.passage.chapters.length === 0 && item.passage.projection === false,
  JSON.stringify(r.body.items ?? r.body),
);
check("only the reference is stored", JSON.stringify(JSON.parse(sql(`select passage from "SetlistItem" where id='${item?.id}'`))) === JSON.stringify({ bibleId: bible.id, reference: "John 3:16-17" }));

r = await call(leader, "POST", `/setlists/${set.id}/items`, { passage: { bibleId: bible.id, reference: "not a passage" } });
check("a reference it can't read: 400", r.status === 400, `${r.status} ${JSON.stringify(r.body?.message)}`);
r = await call(leader, "POST", `/setlists/${set.id}/items`, { passage: { bibleId: bible.id, reference: "John 5:1" } });
check("verses the Bible lacks: 404", r.status === 404, `${r.status} ${JSON.stringify(r.body?.message)}`);
r = await call(leader, "POST", `/setlists/${set.id}/items`, { passage: { bibleId: "nope", reference: "John 3:16" } });
check("a Bible that isn't imported: 404", r.status === 404, `${r.status}`);
r = await call(leader, "POST", `/setlists/${set.id}/items`, { passage: { bibleId: bible.id, reference: "John 3:16" }, text: { title: "", body: "x" } });
check("not a passage and a text", r.status === 400 && /one of songVersionId, text or passage/.test(String(r.body?.message)), `${r.status} ${r.body?.message}`);

r = await call(leader, "GET", `/setlists/${set.id}/items/${item.id}/song`);
check(
  "whoever opens the set reads its verses, its Bible's copyright with them",
  r.status === 200 && r.body.song === null && r.body.item.kind === "PASSAGE" && r.body.passage?.chapters?.[0]?.verses?.map((verse) => verse.number).join() === "16,17" && r.body.passage.bible.copyright === "Public Domain" && r.body.passage.bookName === "John",
  JSON.stringify(r.body.passage ?? r.body).slice(0, 400),
);
const songItem = (await call(leader, "GET", `/setlists/${set.id}`)).body.items[0];
r = await call(leader, "GET", `/setlists/${set.id}/items/${songItem.id}/song`);
check("the song before it names the passage as what's next", r.body.nextTitle === "John 3:16-17", String(r.body.nextTitle));

const versesIn = async (query = "") => {
  const copy = (await call(leader, "GET", `/setlists/${set.id}/offline${query}`)).body;
  return copy.songs.find((view) => view.item.id === item.id)?.passage?.chapters.length ?? -1;
};
check("its Bible may not be kept offline: no verses in the offline copy", (await versesIn()) === 0);
check("nor shown on screens: none in the screens' copy", (await versesIn("?for=screens")) === 0);
await api(admin, "PATCH", `/admin/scriptures/bibles/${bible.id}`, { canProject: true });
check("allowed on screens: the screens' copy has them", (await versesIn("?for=screens")) === 1);
check("still not offline", (await versesIn()) === 0);
await api(admin, "PATCH", `/admin/scriptures/bibles/${bible.id}`, { canOffline: true });
check("allowed offline: the offline copy has them", (await versesIn()) === 1);
check("an unknown copy is refused", (await call(leader, "GET", `/setlists/${set.id}/offline?for=print`)).status === 400);

r = await call(leader, "PATCH", `/setlists/${set.id}/items/${item.id}`, { passage: { bibleId: bible.id, reference: "Ps 23:1-2" }, notes: "Read slowly" });
const changed = r.body.items?.find((one) => one.id === item.id);
check("change its reference and notes", r.status === 200 && changed?.passage?.reference === "Psalms 23:1-2" && changed.notes === "Read slowly", JSON.stringify(changed ?? r.body));
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${item.id}`, { text: { title: "", body: "No" } });
check("a passage has no text", r.status === 400, `${r.status} ${r.body?.message}`);
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${item.id}`, { transposeSteps: 2 });
check("nor a key", r.status === 400, `${r.status}`);
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${songItem.id}`, { passage: { bibleId: bible.id, reference: "John 3:16" } });
check("a song has no passage", r.status === 400, `${r.status} ${r.body?.message}`);

await call(admin, "DELETE", `/admin/scriptures/bibles/${bible.id}`);
r = await call(leader, "GET", `/setlists/${set.id}/items/${item.id}/song`);
check("its Bible deleted: the reference stays, without Bible or verses", r.status === 200 && r.body.passage?.reference === "Psalms 23:1-2" && r.body.passage.bible === null && r.body.passage.chapters.length === 0, JSON.stringify(r.body.passage));
r = await call(leader, "DELETE", `/setlists/${set.id}/items/${item.id}`);
check("removed like any item", r.status === 200 && r.body.items.length === 1);

finish();
