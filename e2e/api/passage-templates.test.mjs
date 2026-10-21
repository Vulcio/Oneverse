// A passage's own screen template (issue #310): picked when it's added to a
// set - a built-in one or a saved one the leader may use - with how many
// verses it puts on a slide; the screens show the passage with it while the
// rest of the set keeps the screen's own.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { importBible } from "../lib/bibles.mjs";

const admin = await user("Template passage admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const leader = await user("Template passages");
const stranger = await user("Template stranger");
const bible = await importBible(admin, `Template Bible ${stamp}`, "TPL", { canProject: true });
const set = await api(leader, "POST", "/setlists", { name: `Template passages ${stamp}` });
const song = (await call(leader, "POST", "/song-versions", { title: `Song first ${stamp}`, language: "en", artists: ["Band"], content: "{start_of_verse}\nOne line\n{end_of_verse}\n", contentFormat: "CHORDPRO" })).body;
await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });

let r = await call(leader, "POST", `/setlists/${set.id}/items`, { passage: { bibleId: bible.id, reference: "John 3:16-17" }, screenTemplate: { builtIn: "scripture" } });
const item = r.body.items?.find((one) => one.kind === "PASSAGE");
check(
  "a passage added with the built-in Scripture template: two verses a slide",
  r.status === 201 && item?.passage?.template?.builtIn === "scripture" && item.passage.template.versesPerSlide === 2 && item.passage.template.id === null,
  JSON.stringify(item ?? r.body),
);
check("kept beside the reference, not in it", JSON.parse(sql(`select "screenTemplate" from "SetlistItem" where id='${item?.id}'`)).builtIn === "scripture" && !JSON.parse(sql(`select passage from "SetlistItem" where id='${item?.id}'`)).screenTemplate);

r = await call(leader, "POST", `/setlists/${set.id}/items`, { passage: { bibleId: bible.id, reference: "John 3:16" }, screenTemplate: { builtIn: "comic-sans" } });
check("a built-in template that doesn't exist: 400", r.status === 400, `${r.status} ${JSON.stringify(r.body?.message)}`);
r = await call(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id, screenTemplate: { builtIn: "scripture" } });
check("a song can't have one", r.status === 400, `${r.status} ${JSON.stringify(r.body?.message)}`);
r = await call(leader, "POST", `/setlists/${set.id}/items`, { passage: { bibleId: bible.id, reference: "John 3:16" }, screenTemplate: { id: "x", builtIn: "scripture" } });
check("one or the other, not both", r.status === 400, `${r.status}`);

// A saved one: three verses a slide, for scripture.
r = await call(leader, "POST", "/screen-themes", { name: `Readings ${stamp}`, content: { builtIn: "chapel" }, background: { builtIn: "chapel" }, effects: null, template: { tags: ["audience", "scripture"], versesPerSlide: 3 } });
check("a template that says three verses a slide", r.status === 201 && r.body.template.versesPerSlide === 3 && r.body.template.tags.includes("scripture"), JSON.stringify(r.body?.template ?? r.body));
const readings = r.body;
r = await call(leader, "POST", "/screen-themes", { name: "Too many", content: { builtIn: "classic" }, background: { builtIn: "classic" }, template: { versesPerSlide: 40 } });
check("more than ten verses a slide: 400", r.status === 400, `${r.status}`);
const strangers = await api(stranger, "POST", "/screen-themes", { name: `Not yours ${stamp}`, content: { builtIn: "classic" }, background: { builtIn: "classic" }, template: { tags: ["scripture"] } });

r = await call(leader, "PATCH", `/setlists/${set.id}/items/${item.id}`, { screenTemplate: { id: strangers.id } });
check("someone else's template: 404", r.status === 404, `${r.status}`);
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${item.id}`, { screenTemplate: { id: readings.id } });
const changed = r.body.items?.find((one) => one.id === item.id);
check("changed to their own: named, three verses a slide", r.status === 200 && changed?.passage?.template?.id === readings.id && changed.passage.template.name === `Readings ${stamp}` && changed.passage.template.versesPerSlide === 3, JSON.stringify(changed?.passage?.template ?? r.body));
const songItem = r.body.items.find((one) => one.kind === "SONG");
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${songItem.id}`, { screenTemplate: { builtIn: "scripture" } });
check("a song item: refused", r.status === 400, `${r.status}`);

r = await call(leader, "GET", `/setlists/${set.id}/offline?for=screens`);
const view = r.body.songs?.find((one) => one.item.id === item.id);
check("the screens' copy carries it, with the verses", view?.passage?.template?.versesPerSlide === 3 && view.passage.chapters[0]?.verses.length === 2, JSON.stringify(view?.passage ?? r.body).slice(0, 300));

// A screen on the set: the passage's look beside the screen's own.
async function anonymous(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const pairing = (await anonymous("POST", "/screens/pairings")).body;
await api(leader, "POST", `/screens/pairings/${pairing.code}/confirm`, { name: `Reading screen ${stamp}`, mode: "LYRICS", setlistId: set.id, themeTemplate: "concert" });
const token = (await anonymous("POST", `/screens/pairings/${pairing.pairingId}/claim`, { secret: pairing.secret })).body.token;
r = await anonymous("GET", "/screens/current", null, { Authorization: `Screen ${token}` });
check(
  "the screen gets the passage's look, by item; the song keeps the screen's",
  r.status === 200 && r.body.itemThemes?.[item.id]?.text?.font === readings.theme.text.font && !r.body.itemThemes[songItem.id] && r.body.theme.background.kind !== r.body.itemThemes[item.id].background.kind,
  JSON.stringify({ itemThemes: Object.keys(r.body?.itemThemes ?? {}), theme: r.body?.theme?.background?.kind }),
);

await api(leader, "DELETE", `/screen-themes/${readings.id}`);
r = await call(leader, "GET", `/setlists/${set.id}`);
check("its template deleted: the screen's own again", r.body.items.find((one) => one.id === item.id)?.passage?.template === null, JSON.stringify(r.body.items.find((one) => one.id === item.id)?.passage?.template));
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${item.id}`, { screenTemplate: { builtIn: "scripture" } });
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${item.id}`, { screenTemplate: null });
check("cleared", r.status === 200 && r.body.items.find((one) => one.id === item.id)?.passage?.template === null && sql(`select coalesce("screenTemplate"::text, 'none') from "SetlistItem" where id='${item.id}'`) === "none");

finish();
