// What people are told besides their calendar (issue #149): a request to
// connect (answered from the notification) and a yes, a song or songbook
// shared, someone joining a set by its link or a team by its invite link, a
// team role changed, a part recorded in a multitrack of one's song; and the
// daily clean-up of old notifications.
import { API, stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const alice = await user("kinds alice");
const bob = await user("kinds bob");
const carol = await user("kinds carol");
sql(`update "User" set "isGlobalAdmin"=true where id='${alice.id}'`);
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);

// --- a request to connect, and a yes
let r = await call(alice, "POST", "/people/requests", { email: bob.email });
const asked = (await notes(bob, "CONNECTION_REQUESTED"))[0];
check("asked to connect: told who, with the request to answer", asked?.data.by === "kinds alice" && !!asked.data.connectionId && asked.url === "/people", JSON.stringify(asked));
r = await call(bob, "POST", `/people/requests/${asked.data.connectionId}/accept`);
check("…answered from it", r.status === 201 || r.status === 204 || r.status === 200, String(r.status));
check("…and the one who asked is told it's a yes", (await notes(alice, "CONNECTION_ACCEPTED"))[0]?.data.by === "kinds bob");
r = await call(bob, "POST", `/people/requests/${asked.data.connectionId}/decline`);
check("answered already: nothing left to answer", r.status === 404, String(r.status));
await call(carol, "POST", "/people/requests", { email: alice.email });
const fromCarol = (await notes(alice, "CONNECTION_REQUESTED"))[0];
await call(alice, "POST", `/people/requests/${fromCarol.data.connectionId}/decline`);
check("a no is never told", (await notes(carol, "CONNECTION_ACCEPTED")).length === 0);

// --- shared with one
const song = (await call(alice, "POST", "/song-versions", { title: `Kinds song ${stamp}`, language: "en", artists: ["Band"], content: "[G]Hello\n" })).body;
await call(alice, "PUT", `/song-versions/${song.id}/shares/${bob.id}`, { canEdit: false });
let shared = await notes(bob, "SONG_SHARED");
check("a song shared: what, by whom, to view", shared.length === 1 && shared[0].data.song === song.title && shared[0].data.canEdit === false && shared[0].url === `/library/${song.id}`, JSON.stringify(shared));
await call(alice, "PUT", `/song-versions/${song.id}/shares/${bob.id}`, { canEdit: false });
check("…shared again as it was: not told twice", (await notes(bob, "SONG_SHARED")).length === 1);
await call(alice, "PUT", `/song-versions/${song.id}/shares/${bob.id}`, { canEdit: true });
shared = await notes(bob, "SONG_SHARED");
check("…to edit now: told", shared.length === 2 && shared[0].data.canEdit === true);
const book = (await call(alice, "POST", "/songbooks", { name: `Kinds book ${stamp}`, kind: "SIMPLE" })).body;
await call(alice, "PUT", `/songbooks/${book.id}/shares/users/${bob.id}`, { canEdit: false });
const bookNote = (await notes(bob, "SONGBOOK_SHARED"))[0];
check("a songbook shared", bookNote?.data.songbook === book.name && bookNote.url === `/songbooks/${book.id}`, JSON.stringify(bookNote));

// --- a part recorded into a multitrack of one's song, by someone else
const wav = () => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + 96000, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(96000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(96000, 40);
  return Buffer.concat([header, Buffer.alloc(96000)]);
};
const record = async (part) => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ type: "AUDIO", stemPart: "OTHER", partName: part, multitrackId: `mtkinds${stamp}`, process: "encode" })) form.append(key, value);
  form.append("file", new Blob([wav()], { type: "audio/wav" }), `${part}.wav`);
  return (await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${bob.bearer}` }, body: form })).status;
};
r = await record("Descant");
const recorded = await notes(alice, "PART_RECORDED");
check("a part recorded in a multitrack of one's song: its owner told", r === 201 && recorded.length === 1 && recorded[0].data.by === "kinds bob" && recorded[0].data.partName === "Descant" && recorded[0].data.song === song.title, `${r} ${JSON.stringify(recorded)}`);
await record("Tenor");
check("…another soon after, still unread: not told again", (await notes(alice, "PART_RECORDED")).length === 1);

// --- a set joined through its link
const set = (await call(alice, "POST", "/setlists", { name: `Kinds set ${stamp}` })).body;
const link = (await call(alice, "POST", `/setlists/${set.id}/share-link`)).body.link;
await call(carol, "POST", `/set-invites/${link.token}/join`);
const joined = (await notes(alice, "SET_JOINED"))[0];
check("someone joins a set by its link: its owner told", joined?.data.by === "kinds carol" && joined.data.set === set.name && joined.url === `/sets/${set.id}`, JSON.stringify(joined));
await call(carol, "POST", `/set-invites/${link.token}/join`);
check("…once", (await notes(alice, "SET_JOINED")).length === 1);

// --- a team joined, a role changed
const team = (await call(alice, "POST", "/teams", { name: `Kinds team ${stamp}` })).body;
const invite = (await call(alice, "POST", `/teams/${team.id}/invite-links`, {})).body;
await call(bob, "POST", `/teams/join/${invite.token}`);
const teamJoined = (await notes(alice, "TEAM_JOINED"))[0];
check("someone joins a team by its invite link: its admins told", teamJoined?.data.by === "kinds bob" && teamJoined.data.team === team.name && teamJoined.data.role === "MEMBER", JSON.stringify(teamJoined));
await call(alice, "PATCH", `/teams/${team.id}/members/${bob.id}`, { role: "ADMIN" });
const role = (await notes(bob, "TEAM_ROLE_CHANGED"))[0];
check("made an admin: told, by whom", role?.data.role === "ADMIN" && role.data.by === "kinds alice" && role.url === `/teams/${team.id}`, JSON.stringify(role));
await call(alice, "PATCH", `/teams/${team.id}/members/${bob.id}`, { role: "ADMIN" });
check("…the same again: not told", (await notes(bob, "TEAM_ROLE_CHANGED")).length === 1);

// --- the daily clean-up
sql(`insert into "Notification" (id, "userId", kind, data, "readAt", "createdAt") values ('oldread${stamp}', '${carol.id}', 'SET_READY', '{}', now() - interval '91 days', now() - interval '91 days'), ('newread${stamp}', '${carol.id}', 'SET_READY', '{}', now() - interval '80 days', now() - interval '80 days'), ('oldunread${stamp}', '${carol.id}', 'SET_READY', '{}', null, now() - interval '366 days'), ('unread${stamp}', '${carol.id}', 'SET_READY', '{}', null, now() - interval '200 days')`);
r = await call(alice, "POST", "/admin/jobs/run/clean-up-notifications");
check("the clean-up run now", r.status === 201 || r.status === 200, String(r.status));
let left = "";
for (let i = 0; i < 60; i++) {
  left = sql(`select string_agg(id, ',' order by id) from "Notification" where id like '%${stamp}'`);
  if (!left.includes("old")) break;
  await new Promise((resolve) => setTimeout(resolve, 300));
}
check("read ones after 90 days and unread ones after a year are gone; the others stay", left === `newread${stamp},unread${stamp}`, left);

finish();
