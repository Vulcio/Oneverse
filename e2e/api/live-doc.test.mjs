// Typing together (issue #27, phase 3): a song's shared document on /sync - only where Admin turned it on, only for who can change
// the song; one device starts it, the others get it; updates and carets relayed; a member's save keeps the room, a save from
// elsewhere (or one discarding) starts it over.
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

const admin = await user("Doc admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const owner = await user("Doc owner");
const coAdmin = await user("Doc co-admin");
const member = await user("Doc member");
const team = await api(owner, "POST", "/teams", { name: `Typing ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('ldc${stamp}', '${team.id}', '${coAdmin.id}', 'ADMIN', now()), ('ldm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now())`);
const song = await api(owner, "POST", "/song-versions", { title: `Typed ${stamp}`, language: "en", artists: ["X"], teamId: team.id });
const revisionNow = () => Number(sql(`select ("documentJson"->>'revision')::int from "SongVersion" where id='${song.id}'`));

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const bytes = (text) => new Uint8Array(Buffer.from(text, "base64"));
/** A device in the song's room: its own Y.Doc, kept up with the updates it hears. */
async function typist(who) {
  const device = await syncDevice(who);
  const typed = { doc: new Y.Doc() };
  const text = () => typed.doc.getText("chart").toString();
  /** Joins with a new document (as a device does after starting over). */
  const join = async (revision = revisionNow()) => {
    typed.doc = new Y.Doc();
    const doc = typed.doc;
    const answer = device.next((m) => (m.type === "doc-state" || m.type === "doc-refused") && m.songVersionId === song.id);
    device.send({ type: "doc-join", songVersionId: song.id, revision });
    const state = await answer;
    if (state?.type === "doc-state" && state.state) Y.applyUpdate(doc, bytes(state.state));
    return state;
  };
  /** Types, sending the change; `seed` for the document's start. */
  const type = (words, seed = false) => {
    const doc = typed.doc;
    let update;
    const take = (u) => (update = u);
    doc.on("update", take);
    doc.getText("chart").insert(doc.getText("chart").length, words);
    doc.off("update", take);
    device.send({ type: "doc-update", songVersionId: song.id, update: b64(update), ...(seed && { seed: true }) });
  };
  /** Waits for the room's next update and takes it in. */
  const hear = async (ms) => {
    const message = await device.next((m) => m.type === "doc-update" && m.songVersionId === song.id, ms);
    if (message) Y.applyUpdate(typed.doc, bytes(message.update));
    return message;
  };
  return { ...device, get doc() { return typed.doc; }, text, join, type, hear };
}

// --- off until Admin turns it on
await api(admin, "DELETE", "/admin/collaboration");
let r = await call(admin, "GET", "/admin/collaboration");
check("Admin: off, from nothing configured", r.status === 200 && r.body.settings.liveCoEditing.value === false && r.body.source === "none", JSON.stringify(r.body));
check("…not for anyone else", (await call(owner, "GET", "/admin/collaboration")).status === 403);
const ownerOne = await typist(owner);
check("signing in says it's off", ownerOne.ready?.type === "ready" && ownerOne.ready.coEditing === false, JSON.stringify(ownerOne.ready));
r = await ownerOne.join();
check("joining is refused while it's off", r?.type === "doc-refused" && r.reason === "off", JSON.stringify(r));

await api(admin, "PUT", "/admin/collaboration", { liveCoEditing: true });
r = await call(admin, "GET", "/admin/collaboration");
check("Admin turns it on", r.body.settings.liveCoEditing.value === true && r.body.source === "database", JSON.stringify(r.body));
check("…a bad value refused", (await call(admin, "PUT", "/admin/collaboration", { liveCoEditing: "yes" })).status === 400);

try {
  const memberOne = await typist(member);
  check("signing in says it's on", memberOne.ready?.coEditing === true);
  r = await memberOne.join();
  check("someone who can't change the song can't join", r?.type === "doc-refused" && r.reason === "forbidden", JSON.stringify(r));
  memberOne.close();

  // --- one device starts the document, the others get it
  const start = revisionNow();
  r = await ownerOne.join(start);
  check("the first to join starts the document", r?.type === "doc-state" && r.seed === true && r.state === null && r.revision === start, JSON.stringify(r));
  const coOne = await typist(coAdmin);
  r = await coOne.join(start);
  check("…the next waits for it", r?.type === "doc-state" && r.seed === false && r.state === null, JSON.stringify(r));
  ownerOne.type("Hello", true);
  await coOne.hear();
  check("the start reaches who's waiting", coOne.text() === "Hello", coOne.text());
  coOne.type(" world", true);
  r = await coOne.next((m) => m.type === "doc-reset");
  check("a start from a device that wasn't picked is refused: it starts over", r !== null);
  r = await coOne.join(start);
  check("…and joining again gets the document", r?.type === "doc-state" && r.seed === false && coOne.text() === "Hello", JSON.stringify(r));

  // --- typing, relayed
  coOne.type(" world");
  await ownerOne.hear();
  check("what one types reaches the other", ownerOne.text() === "Hello world", ownerOne.text());
  ownerOne.type("!");
  await coOne.hear();
  check("…both ways", coOne.text() === "Hello world!", coOne.text());
  check("not back to who typed it", (await ownerOne.hear(600)) === null);
  ownerOne.send({ type: "doc-update", songVersionId: song.id, update: "bm90IGFuIHVwZGF0ZQ==" });
  r = await ownerOne.next((m) => m.type === "error");
  check("an update Yjs can't read is refused", r?.code === "bad-request", JSON.stringify(r));

  // --- carets: relayed, kept for who joins later, gone with the device
  const caret = new awarenessProtocol.Awareness(coOne.doc);
  caret.setLocalStateField("user", { name: "Doc co-admin", color: "#e11d48" });
  coOne.send({ type: "doc-awareness", songVersionId: song.id, update: b64(awarenessProtocol.encodeAwarenessUpdate(caret, [coOne.doc.clientID])) });
  const ownerCarets = new awarenessProtocol.Awareness(ownerOne.doc);
  r = await ownerOne.next((m) => m.type === "doc-awareness");
  if (r) awarenessProtocol.applyAwarenessUpdate(ownerCarets, bytes(r.update), "remote");
  check("a caret reaches the others", ownerCarets.getStates().get(coOne.doc.clientID)?.user?.name === "Doc co-admin");
  const ownerTwo = await typist(owner);
  r = await ownerTwo.join();
  const late = await ownerTwo.next((m) => m.type === "doc-awareness");
  check("who joins later gets the document and the carets already there", r?.state && ownerTwo.text() === "Hello world!" && late !== null, JSON.stringify(r));
  coOne.close();
  r = await ownerOne.next((m) => m.type === "doc-awareness");
  if (r) awarenessProtocol.applyAwarenessUpdate(ownerCarets, bytes(r.update), "remote");
  check("a device that goes takes its caret with it", r !== null && !ownerCarets.getStates().has(coOne.doc.clientID));
  // Their timers would keep the suite running.
  caret.destroy();
  ownerCarets.destroy();

  // --- saves: a member's keeps the room; one from elsewhere starts it over
  await call(owner, "PATCH", `/song-versions/${song.id}`, { contentFormat: "CHORDPRO", content: "[G]Hello world!\n", revision: revisionNow() });
  ownerOne.send({ type: "doc-saved", songVersionId: song.id, revision: revisionNow() });
  check("a save a member says was theirs keeps the room", (await ownerTwo.next((m) => m.type === "doc-reset", 4500)) === null);
  const saved = revisionNow();
  const behind = await typist(owner);
  r = await behind.join(saved - 1);
  behind.close();
  check("…at its revision now (a device that loaded before it is told)", r?.type === "doc-state" && r.revision === saved && r.state !== null, JSON.stringify(r));
  await call(admin, "PATCH", `/song-versions/${song.id}`, { contentFormat: "CHORDPRO", content: "[G]Restored\n" });
  r = await Promise.all([ownerOne.next((m) => m.type === "doc-reset", 6000), ownerTwo.next((m) => m.type === "doc-reset", 6000)]);
  check("a save from elsewhere starts the room over, for everyone in it", r.every((one) => one !== null));
  const fresh = await typist(owner);
  r = await fresh.join();
  check("…the next to join starts it from the song as saved", r?.seed === true && r.revision === revisionNow(), JSON.stringify(r));
  fresh.type("Restored", true);
  r = await ownerOne.join();
  check("…which the others get on joining again", r?.state && ownerOne.text() === "Restored", JSON.stringify(r));

  // A room behind the song (saved while nobody was in it to hear) is dropped by who loaded the song since.
  sql(`update "SongVersion" set "documentJson" = jsonb_set("documentJson", '{revision}', to_jsonb(("documentJson"->>'revision')::int + 1)) where id='${song.id}'`);
  const newer = await typist(owner);
  r = await newer.join();
  check("a room behind the song is dropped: who loaded it since starts again", r?.seed === true, JSON.stringify(r));
  check("…and who was in it is told", (await ownerOne.next((m) => m.type === "doc-reset")) !== null);
  newer.type("Newer", true);
  await ownerOne.join();

  // Discarding drops what nobody saved, for everyone.
  ownerOne.send({ type: "doc-discard", songVersionId: song.id });
  r = await Promise.all([ownerOne.next((m) => m.type === "doc-reset"), newer.next((m) => m.type === "doc-reset")]);
  check("discarding starts the room over for everyone", r.every((one) => one !== null));

  // Joining again after Admin turned it off.
  await call(admin, "PUT", "/admin/collaboration", { liveCoEditing: false });
  r = await newer.join();
  check("turned off: joining is refused again", r?.type === "doc-refused" && r.reason === "off", JSON.stringify(r));
  for (const one of [ownerOne, ownerTwo, fresh, newer]) one.close();
} finally {
  await api(admin, "DELETE", "/admin/collaboration");
}
r = await call(admin, "GET", "/admin/collaboration");
check("Revert to environment variables: off again", r.body.source !== "database" && r.body.settings.liveCoEditing.value === false, JSON.stringify(r.body));
finish();
