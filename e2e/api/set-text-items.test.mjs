// A set's text items (issue #305): an announcement or a reading, written in
// the set, whose paragraphs are its slides. It has no song, so nothing of a
// song's (a version, a key, an arrangement) is taken; the set, a player's
// view of it and its offline copy all carry it.
import { stamp, check, user, call, finish } from "../lib/harness.mjs";

const leader = await user("Texts");
const song = (await call(leader, "POST", "/song-versions", { title: `Before the text ${stamp}`, language: "en", artists: ["Band"], content: "{start_of_verse}\nOne line\n{end_of_verse}\n", contentFormat: "CHORDPRO" })).body;
const set = (await call(leader, "POST", "/setlists", { name: `Texts ${stamp}` })).body;
await call(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });

let r = await call(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "  Welcome  ", body: "Welcome, everyone\n\nCoffee after the service" } });
const text = r.body.items?.[1];
check("add a text item after the song", r.status === 201 && text?.kind === "TEXT" && text.song === null && text.text?.title === "Welcome" && text.text.body.startsWith("Welcome, everyone"), JSON.stringify(r.body.items ?? r.body));
check("the song item says it's a song", r.body.items?.[0]?.kind === "SONG" && r.body.items[0].song?.id === song.id);

r = await call(leader, "POST", `/setlists/${set.id}/items`, {});
check("an item needs a song or a text", r.status === 400 && /songVersionId or text/.test(String(r.body?.message)), `${r.status} ${r.body?.message}`);
r = await call(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id, text: { title: "", body: "Both" } });
check("not both", r.status === 400, `${r.status} ${r.body?.message}`);
r = await call(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "", body: "x".repeat(5001) } });
check("a text's body is 5000 characters at most", r.status === 400, `${r.status} ${r.body?.message}`);

r = await call(leader, "PATCH", `/setlists/${set.id}/items/${text.id}`, { text: { title: "Notices", body: "Welcome\n\nCoffee\n\nSee you next week" }, notes: "Read slowly" });
const changed = r.body.items?.find((item) => item.id === text.id);
check("change a text and its notes", r.status === 200 && changed?.text?.title === "Notices" && changed.notes === "Read slowly", JSON.stringify(changed ?? r.body));
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${text.id}`, { transposeSteps: 2 });
check("a text has no key", r.status === 400, `${r.status} ${r.body?.message}`);
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${text.id}`, { songVersionId: song.id });
check("nor a version", r.status === 400, `${r.status} ${r.body?.message}`);
r = await call(leader, "POST", `/setlists/${set.id}/items/${text.id}/set-arrangement`, { name: "Mine" });
check("nor an arrangement", r.status === 400, `${r.status} ${r.body?.message}`);
const songItem = (await call(leader, "GET", `/setlists/${set.id}`)).body.items[0];
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${songItem.id}`, { text: { title: "", body: "No" } });
check("a song has no text", r.status === 400, `${r.status} ${r.body?.message}`);

r = await call(leader, "GET", `/setlists/${set.id}/items/${text.id}/song`);
check("a player's view of it: its text, no song", r.status === 200 && r.body.song === null && r.body.text?.title === "Notices" && r.body.item.kind === "TEXT", JSON.stringify(r.body).slice(0, 300));
r = await call(leader, "GET", `/setlists/${set.id}/items/${songItem.id}/song`);
check("the song before it names the text as what's next", r.body.nextTitle === "Notices", String(r.body.nextTitle));

r = await call(leader, "GET", `/setlists/${set.id}/offline`);
const copied = r.body.songs?.find((view) => view.item.id === text.id);
check("the set's offline copy carries the text (screens show it from there)", r.status === 200 && copied?.text?.body.includes("See you next week") && copied.song === null, JSON.stringify(copied ?? r.body).slice(0, 300));

r = await call(leader, "PUT", `/setlists/${set.id}/items/order`, { itemIds: [text.id, songItem.id] });
check("a text moves like a song", r.status === 200 && r.body.items[0].id === text.id);
r = await call(leader, "DELETE", `/setlists/${set.id}/items/${text.id}`);
check("and is removed like one", r.status === 200 && r.body.items.length === 1 && r.body.items[0].position === 0);

finish();
