// Live notes (issue #27): a device watches songs on /sync and hears when their notes change - added, replied to, edited, resolved,
// deleted - with nothing about the notes themselves; only songs it could open (in its library, or through the set it's opened in).
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const owner = await user("Notes owner");
const member = await user("Notes member");
const guest = await user("Notes guest");
const stranger = await user("Notes stranger");
const team = await api(owner, "POST", "/teams", { name: `Live notes ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('lnm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now())`);
const song = await api(owner, "POST", "/song-versions", { title: `Live ${stamp}`, language: "en", artists: ["X"], teamId: team.id });
const set = await api(owner, "POST", "/setlists", { name: `Live set ${stamp}`, teamId: team.id });
await api(owner, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
const token = (await api(owner, "POST", `/setlists/${set.id}/share-link`)).link.token;
await api(guest, "POST", `/set-invites/${token}/join`);

/** A device signed in: its messages as they come, and a wait for the next one that matches (null after `ms`). */
async function device(who) {
  const ws = new WebSocket(`${API.replace(/^http/, "ws")}/sync`);
  const messages = [];
  const waiting = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const w = waiting.find((one) => one.match(message));
    if (w) {
      waiting.splice(waiting.indexOf(w), 1);
      w.resolve(message);
    } else messages.push(message);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const next = (match, ms = 3000) =>
    new Promise((resolve) => {
      const early = messages.findIndex(match);
      if (early >= 0) return resolve(messages.splice(early, 1)[0]);
      const w = { match, resolve };
      waiting.push(w);
      setTimeout(() => {
        if (waiting.includes(w)) {
          waiting.splice(waiting.indexOf(w), 1);
          resolve(null);
        }
      }, ms);
    });
  const send = (message) => ws.send(JSON.stringify(message));
  const ready = next((m) => m.type === "ready");
  send({ type: "hello", token: who.bearer });
  await ready;
  const watch = async (songs) => {
    const answer = next((m) => m.type === "watching" || m.type === "error");
    send({ type: "watch", songs });
    return answer;
  };
  const heard = (ms) => next((m) => m.type === "notes" && m.songVersionId === song.id, ms);
  return { watch, heard, next, close: () => ws.close() };
}

const memberDevice = await device(member);
const guestDevice = await device(guest);
const strangerDevice = await device(stranger);

let r = await memberDevice.watch([{ songVersionId: song.id }]);
check("a team member watches the team's song", r?.type === "watching" && r.songVersionIds.includes(song.id), JSON.stringify(r));
r = await guestDevice.watch([{ songVersionId: song.id }]);
check("a guest can't watch it outside the set", r?.type === "watching" && r.songVersionIds.length === 0, JSON.stringify(r));
r = await guestDevice.watch([{ songVersionId: song.id, setlistId: set.id }]);
check("…but can in the set they joined", r?.type === "watching" && r.songVersionIds.includes(song.id), JSON.stringify(r));
r = await strangerDevice.watch([{ songVersionId: song.id }, { songVersionId: song.id, setlistId: set.id }]);
check("a stranger can't watch it at all", r?.type === "watching" && r.songVersionIds.length === 0, JSON.stringify(r));
r = await strangerDevice.watch(Array.from({ length: 31 }, (_, i) => ({ songVersionId: `s${i}` })));
check("too many songs at once is refused", r?.type === "error" && r.code === "bad-request", JSON.stringify(r));

// Each change is heard by who watches, with nothing in it but the song.
const note = (await call(owner, "POST", "/notes", { songVersionId: song.id, content: "Let ring", place: "TEAM", teamId: team.id })).body;
r = await memberDevice.heard();
check("a note added is heard at once", r !== null && Object.keys(r).sort().join(",") === "songVersionId,type", JSON.stringify(r));
check("…by the guest in the set too (they read only what they may)", (await guestDevice.heard()) !== null);
check("…not by the stranger", (await strangerDevice.heard(800)) === null);
check("the guest reading again sees nothing of the team's note", !(await api(guest, "GET", `/song-versions/${song.id}/notes?setlistId=${set.id}`)).notes.some((n) => n.id === note.id));

await call(member, "POST", `/notes/${note.id}/replies`, { content: "Agreed" });
check("a reply is heard", (await memberDevice.heard()) !== null);
await call(owner, "PATCH", `/notes/${note.id}`, { resolved: true });
check("resolving is heard", (await memberDevice.heard()) !== null);
await call(owner, "DELETE", `/notes/${note.id}`);
check("deleting is heard", (await memberDevice.heard()) !== null);

await memberDevice.watch([]);
await call(owner, "POST", "/notes", { songVersionId: song.id, content: "Again", place: "SONG" });
check("watching nothing more: not told", (await memberDevice.heard(800)) === null);

for (const one of [memberDevice, guestDevice, strangerDevice]) one.close();
finish();
