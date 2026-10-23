// Cue (issue #322): someone with a role that cues - a singer - moves a set's
// screens to the next or previous song or section from Live, and to nowhere
// else. Where to is worked out by the session from the set (core's
// cueTarget), never sent; checked against what the screens showed like a
// Next, refused while the screens are locked to someone else, and carried by
// the pass for Pulse's room.
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

const admin = await user("Cue admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const leader = await user("Cue leader");
const singer = await user("Cue singer");
const guest = await user("Cue guest");

const role = await api(admin, "POST", "/admin/roles", { name: `Cue ${stamp}`, canCue: true });
check("Admin > Roles: a role that cues", (await api(admin, "GET", "/admin/roles")).find((one) => one.id === role.id)?.canCue === true);
await api(admin, "PUT", `/admin/users/${singer.id}/roles`, { roleIds: [role.id, "role_audio_uploads"] });

const set = await api(leader, "POST", "/setlists", { name: `Cue ${stamp}` });
const song = await api(leader, "POST", "/song-versions", {
  title: `Cued ${stamp}`,
  language: "en",
  artists: ["Band"],
  content: "{start_of_verse}\n[G]Amazing grace\nhow [C]sweet the sound\nthat saved\na wretch like me\n{end_of_verse}\n{start_of_chorus}\nMy chains are gone\n{end_of_chorus}\n",
  contentFormat: "CHORDPRO",
});
const [songItem] = (await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id })).items;
const notices = (await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo" } })).items.find((one) => one.id !== songItem.id);
const token = (await api(leader, "POST", `/setlists/${set.id}/share-link`)).link.token;
await call(singer, "POST", `/set-invites/${token}/join`);
await call(guest, "POST", `/set-invites/${token}/join`);

const devices = [];
async function joined(who, name) {
  const device = await syncDevice(who);
  devices.push(device);
  device.send({ type: "join", setId: set.id, deviceId: `${name}-${stamp}` });
  return { device, session: await device.next((m) => m.type === "session") };
}
const answer = (device, id) => device.next((m) => (m.type === "ack" || m.type === "error") && m.id === id);
let n = 0;
async function cue(device, direction, to, basedOn) {
  const id = `cue-${++n}-${stamp}`;
  device.send({ type: "command", id, op: { kind: "cue", direction, to, ...(basedOn !== undefined && { basedOn }) } });
  return answer(device, id);
}
const shown = (device, test) => device.next((m) => m.type === "session" && !!m.session?.presenting && test(m.session.presenting));

try {
  const { device: desk } = await joined(leader, "desk");
  desk.send({ type: "command", id: `lead-${stamp}`, op: { kind: "lead" } });
  await answer(desk, `lead-${stamp}`);
  desk.send({ type: "command", id: `show-${stamp}`, op: { kind: "present", presenting: { itemId: songItem.id, slide: 0, black: false } } });
  await answer(desk, `show-${stamp}`);

  const { device: phone, session: first } = await joined(singer, "phone");
  check("the singer may cue, not present", first?.canCue === true && first.canPresent === false, JSON.stringify({ canCue: first?.canCue, canPresent: first?.canPresent }));

  let a = await cue(phone, "next", "section");
  check("next section: acknowledged", a?.type === "ack", JSON.stringify(a));
  let s = await shown(phone, (p) => p.itemId === songItem.id && p.slide > 0);
  // The verse's four lines are two slides: the chorus starts at the third.
  check("…the screens on the chorus, with the song's slide key", s?.session.presenting.slide === 2 && !!s.session.presenting.slideKey, JSON.stringify(s?.session.presenting));
  const rev = s?.session.presentingRev;

  a = await cue(phone, "next", "item", rev);
  check("next song: acknowledged", a?.type === "ack", JSON.stringify(a));
  s = await shown(phone, (p) => p.itemId === notices.id);
  check("…the screens on the next item's first slide", s?.session.presenting.slide === 0, JSON.stringify(s?.session.presenting));

  a = await cue(phone, "previous", "section", rev);
  check("decided from what's no longer shown: refused as stale", a?.type === "error" && a.code === "stale", JSON.stringify(a));

  a = await cue(phone, "previous", "section");
  s = await shown(phone, (p) => p.itemId === songItem.id);
  check("previous section from an item's first: the song's last section", a?.type === "ack" && s?.session.presenting.slide === 2, JSON.stringify(s?.session.presenting));

  phone.send({ type: "command", id: `present-${stamp}`, op: { kind: "present", presenting: { itemId: songItem.id, slide: 1, black: false } } });
  a = await answer(phone, `present-${stamp}`);
  check("cueing isn't presenting: any slide is refused", a?.type === "error" && a.code === "forbidden", JSON.stringify(a));

  const { device: other, session: theirs } = await joined(guest, "other");
  check("someone without the role may not cue", theirs?.canCue === false, JSON.stringify(theirs?.canCue));
  a = await cue(other, "next", "item");
  check("…and is refused", a?.type === "error" && a.code === "forbidden", JSON.stringify(a));

  phone.send({ type: "pass" });
  const pass = (await phone.next((m) => m.type === "pass"))?.pass;
  const payload = pass ? JSON.parse(Buffer.from(pass.split(".")[0], "base64url").toString()) : null;
  check("the pass for Pulse's room says they cue", payload?.canCue === true, JSON.stringify(payload));

  desk.send({ type: "command", id: `lock-${stamp}`, op: { kind: "screens", control: "exclusive" } });
  await answer(desk, `lock-${stamp}`);
  a = await cue(phone, "next", "item");
  check("screens locked to someone else: refused", a?.type === "error" && a.code === "forbidden", JSON.stringify(a));
} finally {
  for (const device of devices) device.close();
}

finish();
