// Splitting a recording into stems with our Demucs API (issue #63), against
// a fake one (e2e/lib/fake-demucs.mjs): set up in Admin; granted to users
// and teams; a recording sent; its fast stems brought in by the Worker as a
// multitrack (a signed webhook, or its polling), locked, timed as the
// recording; the HQ pass's stems in their place later; 6 parts, and the
// vocals and the rest; a forged webhook refused; the monthly limit.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { FAKE_DEMUCS_KEY, FAKE_DEMUCS_URL, startFakeDemucs, toneWav } from "../lib/fake-demucs.mjs";

const demucs = await startFakeDemucs();
const admin = await user("Stems admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const singer = await user("Stems singer");
const member = await user("Stems member");
const outsider = await user("Stems outsider");

/** Waits until `ready(body)` of the song's separations, or 30 s. */
async function waitFor(who, songId, ready) {
  let body;
  for (let i = 0; i < 60; i++) {
    body = (await call(who, "GET", `/song-versions/${songId}/stem-separations`)).body;
    if (ready(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`waited: ${JSON.stringify(body)}`);
}
async function upload(who, songId, name, bytes, extra = {}) {
  const form = new FormData();
  form.append("type", "AUDIO");
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  form.append("file", new Blob([bytes], { type: "audio/wav" }), name);
  return (await fetch(`${API}/song-versions/${songId}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${who.bearer}` }, body: form })).json();
}

try {
  const song = await api(singer, "POST", "/song-versions", { title: `Split ${stamp}`, language: "en", artists: ["Band"], content: "[G]Hello\n", contentFormat: "CHORDPRO" });
  const recording = await upload(singer, song.id, "Full mix.wav", toneWav(300, 2), { recordingTempo: "96", recordingKey: "G" });

  let r = await call(singer, "GET", `/song-versions/${song.id}/stem-separations`);
  check("not set up: not offered", r.body.available === false && r.body.refusal === "not-configured", JSON.stringify(r.body));

  // --- Admin sets it up
  r = await call(singer, "PUT", "/admin/stem-separation", { apiUrl: FAKE_DEMUCS_URL });
  check("only global admins set it up", r.status === 403, String(r.status));
  r = await call(admin, "PUT", "/admin/stem-separation", { apiUrl: `${FAKE_DEMUCS_URL}/`, apiKey: FAKE_DEMUCS_KEY });
  check("saved", r.status === 204, String(r.status));
  r = await call(admin, "GET", "/admin/stem-separation");
  check("read back, never its key", r.body.source === "database" && r.body.apiUrl === FAKE_DEMUCS_URL && r.body.hasDatabaseKey && !JSON.stringify(r.body).includes(FAKE_DEMUCS_KEY) && r.body.fastModel === "htdemucs" && r.body.hqModel === "htdemucs_ft" && r.body.hqEnabled, JSON.stringify(r.body));
  r = await call(admin, "POST", "/admin/stem-separation/test");
  check("Test connection: its health and models", r.body.ok && r.body.health.status === "ok" && r.body.models.models.includes("htdemucs_6s"), JSON.stringify(r.body));

  // --- Who may use it
  r = await call(singer, "GET", `/song-versions/${song.id}/stem-separations`);
  check("not granted: not offered", r.body.available === false && r.body.refusal === "not-granted", JSON.stringify(r.body));
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "4" });
  check("nor can it be started", r.status === 403, String(r.status));
  // Given by a role (issue #160): the built-in Stem separation one.
  const stemsRole = (await api(admin, "GET", "/admin/roles")).find((role) => role.builtIn === "STEM_SEPARATION");
  r = await call(admin, "PUT", `/admin/users/${singer.id}/roles`, { roleIds: [stemsRole.id, "role_audio_uploads"] });
  check("the Stem separation role given to a user", r.status === 204, String(r.status));
  r = await call(singer, "GET", "/users/me");
  check("their profile says they can", r.body.canSeparateStems === true && r.body.roles.includes("Stem separation"), JSON.stringify(r.body.roles));

  // --- A recording, split: its fast stems as a multitrack
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "4" });
  check("started", r.status === 201 && r.body.status === "QUEUED" && r.body.hqRequested === true, JSON.stringify(r.body));
  const first = r.body;
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "4" });
  check("not twice at once", r.status === 400, String(r.status));
  let list = await waitFor(singer, song.id, (body) => body.separations[0]?.status === "FAST_READY");
  const sent = demucs.received.at(-1);
  check("sent as it is, the fast model now and the HQ one tonight, with where to call back", sent.bytes > 30000 && sent.model === "htdemucs" && sent.hqEnabled && sent.hqModel === "htdemucs_ft" && sent.callbackUrl?.endsWith("/stem-separation/callback"), JSON.stringify(sent));
  check("its signed webhook taken", demucs.webhooks.some((hook) => hook.event === "fast.completed" && hook.status === 204), JSON.stringify(demucs.webhooks));
  const multitrackId = list.separations[0].multitrackId;
  let files = (await api(singer, "GET", `/song-versions/${song.id}/attachments`)).filter((file) => file.multitrackId === multitrackId);
  check(
    "a multitrack of 4 parts, Opus, locked, timed as the recording (its key and tempo)",
    files.length === 4 &&
      ["VOCALS", "DRUMS", "BASS", "OTHER"].every((part) => files.some((file) => file.stemPart === part)) &&
      files.every((file) => file.multitrackName === "Separated (4 parts)" && file.origin === "SEPARATED" && file.mimeType === "audio/ogg" && file.locked && file.recordingTempo === 96 && file.recordingKey === "G"),
    JSON.stringify(files.map((file) => [file.stemPart, file.mimeType, file.locked, file.recordingTempo])),
  );
  const fastIds = files.map((file) => file.id).sort();

  // --- Tonight: the HQ pass's stems in their place
  const jobId = sent && demucs.received.length && (await call(singer, "GET", `/song-versions/${song.id}/stem-separations`)).body.separations[0] && sql(`select "jobId" from "StemSeparation" where id='${first.id}'`);
  await demucs.completeHq(jobId);
  list = await waitFor(singer, song.id, (body) => body.separations[0]?.status === "COMPLETED");
  files = (await api(singer, "GET", `/song-versions/${song.id}/attachments`)).filter((file) => file.multitrackId === multitrackId);
  check(
    "the HQ stems in place of the fast ones: the same parts, new files",
    list.separations[0].hqDone && files.length === 4 && files.every((file) => !fastIds.includes(file.id)) && files.every((file) => file.locked && file.recordingTempo === 96),
    JSON.stringify(files.map((file) => file.id)),
  );

  // --- A forged webhook
  check("a webhook not signed with its secret is refused", (await demucs.forge(`${API}/stem-separation/callback`, jobId)) === 403);

  // --- 6 parts; the vocals and the rest
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "6" });
  check("6 parts: no finer pass asked for (issue #174 - no 6-part model for it)", r.body.hqRequested === false, JSON.stringify(r.body));
  list = await waitFor(singer, song.id, (body) => body.separations[0]?.id === r.body.id && body.separations[0].status === "COMPLETED");
  files = (await api(singer, "GET", `/song-versions/${song.id}/attachments`)).filter((file) => file.multitrackId === list.separations[0].multitrackId);
  check("6 parts: guitar and piano too, sent without a finer pass", demucs.received.at(-1).model === "htdemucs_6s" && !demucs.received.at(-1).hqEnabled && list.separations[0].fastModel === "htdemucs_6s" && list.separations[0].hqModel === null && files.length === 6 && files.some((file) => file.stemPart === "GUITAR") && files.some((file) => file.stemPart === "KEYS" && file.partName === "Piano"), JSON.stringify(files.map((file) => [file.stemPart, file.partName])));
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "2" });
  list = await waitFor(singer, song.id, (body) => body.separations[0]?.id === r.body.id && body.separations[0].status === "FAST_READY");
  files = (await api(singer, "GET", `/song-versions/${song.id}/attachments`)).filter((file) => file.multitrackId === list.separations[0].multitrackId);
  check("2 parts: the vocals and an instrumental", demucs.received.at(-1).twoStems === "vocals" && files.length === 2 && files.some((file) => file.stemPart === "VOCALS") && files.some((file) => file.partName === "Instrumental"), JSON.stringify(files.map((file) => [file.stemPart, file.partName])));

  // --- A team's songs, for its members
  const team = await api(admin, "POST", "/teams", { name: `Split band ${stamp}` });
  sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('tmsep${stamp}', '${team.id}', '${member.id}', 'MEMBER', now())`);
  const teamSong = await api(admin, "POST", "/song-versions", { title: `Team split ${stamp}`, language: "en", artists: ["Band"], teamId: team.id, content: "[G]Hi\n", contentFormat: "CHORDPRO" });
  const teamRecording = await upload(admin, teamSong.id, "Band.wav", toneWav(200, 2), { visibility: "SONG" });
  r = await call(member, "GET", `/song-versions/${teamSong.id}/stem-separations`);
  check("a team not granted: its members can't", r.body.available === false, JSON.stringify(r.body));
  await call(admin, "PUT", `/admin/teams/${team.id}/roles`, { roleIds: [stemsRole.id] });
  r = await call(member, "POST", `/song-versions/${teamSong.id}/attachments/${teamRecording.id}/separate`, {});
  check("granted to the team: a member splits its song's recording (4 parts by default)", r.status === 201 && r.body.parts === "4", JSON.stringify(r.body));
  r = await call(outsider, "GET", `/song-versions/${teamSong.id}/stem-separations`);
  check("someone outside it can't see the song's", r.status === 403 || r.status === 404, String(r.status));

  // --- The monthly limit
  await call(admin, "PUT", "/admin/stem-separation", { monthlyLimit: 1 });
  r = await call(member, "POST", `/song-versions/${teamSong.id}/attachments/${teamRecording.id}/separate`, { parts: "2" });
  check("over the monthly limit: refused, saying so", r.status === 429 && /in 30 days/.test(r.body.message[0]), JSON.stringify(r.body));
} finally {
  await call(admin, "DELETE", "/admin/stem-separation");
  await demucs.close();
}

finish();
