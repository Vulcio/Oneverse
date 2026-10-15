// Live notes (issue #27): a device watches songs on /sync and hears when their notes change - added, replied to, edited, resolved,
// deleted - with nothing about the notes themselves; only songs it could open (in its library, or through the set it's opened in).
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

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

/** A device signed in, watching songs: `heard` waits for the next change to the song's notes. */
async function device(who) {
  const one = await syncDevice(who);
  const watch = async (songs) => {
    const answer = one.next((m) => m.type === "watching" || m.type === "error");
    one.send({ type: "watch", songs });
    return answer;
  };
  const heard = (ms) => one.next((m) => m.type === "notes" && m.songVersionId === song.id, ms);
  return { ...one, watch, heard };
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

// --- presence (phase 2): who's editing or replying, to who watches the song
await memberDevice.watch([{ songVersionId: song.id }]);
const memberPresence = (match) => memberDevice.next((m) => m.type === "presence" && m.songVersionId === song.id && match(m.people));
const guestPresence = (match) => guestDevice.next((m) => m.type === "presence" && m.songVersionId === song.id && match(m.people));
const ownerDevice = await device(owner);
await ownerDevice.watch([{ songVersionId: song.id }]);
const sendOwner = (message) => ownerDevice.send(message);
sendOwner({ type: "presence", songVersionId: song.id, doing: "editing" });
r = await memberPresence((people) => people.some((p) => p.userId === owner.id && p.doing === "editing"));
check("someone editing is seen by who watches the song", r !== null && r.people.find((p) => p.userId === owner.id)?.name === "Notes owner", JSON.stringify(r));
r = await guestPresence((people) => people.some((p) => p.userId === owner.id));
check("…a guest in the set too", r !== null);
const late = await device(member);
r = await late.watch([{ songVersionId: song.id }]);
r = await late.next((m) => m.type === "presence" && m.people.some((p) => p.userId === owner.id));
check("a device that starts watching hears who's there at once", r !== null);
late.close();
sendOwner({ type: "presence", songVersionId: song.id, doing: "replying", noteId: "note_1" });
r = await memberPresence((people) => people.some((p) => p.userId === owner.id && p.doing === "replying" && p.noteId === "note_1"));
check("replying to a note: which note", r !== null, JSON.stringify(r));
const strangerTries = await device(stranger);
strangerTries.send({ type: "presence", songVersionId: song.id, doing: "editing" });
r = await strangerTries.next((m) => m.type === "error");
check("presence in a song not watched (can't be) is refused", r?.code === "forbidden", JSON.stringify(r));
strangerTries.close();
ownerDevice.close();
r = await memberPresence((people) => !people.some((p) => p.userId === owner.id));
check("gone when the device goes", r !== null);

// --- a song saved, heard by who watches it: by whom, and its revision now
await call(owner, "PATCH", `/song-versions/${song.id}`, { contentFormat: "CHORDPRO", content: "[G]Saved live\n" });
const revision = JSON.parse(sql(`select "documentJson" from "SongVersion" where id='${song.id}'`)).revision;
r = await memberDevice.next((m) => m.type === "song" && m.songVersionId === song.id);
check("a save is heard: by whom, at which revision", r?.revision === revision && r.by === "Notes owner" && r.byId === owner.id, JSON.stringify(r));
check("…not by a stranger", (await strangerDevice.next((m) => m.type === "song", 800)) === null);

for (const one of [memberDevice, guestDevice, strangerDevice]) one.close();
finish();
