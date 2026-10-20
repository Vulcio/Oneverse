// A separation's details (issues #174, #175), against the fake Demucs API:
// the models it was sent with and the recording's name, kept; the
// multitrack named by its parts; what the server's analysis found filled in
// where the recording has nothing, marked detected until confirmed or
// changed, its sections placed on the song's; recordings people make into
// the multitrack apart from its stems - never replaced by the finer pass,
// moved over when a re-run replaces the stems, which takes over their
// sections and name.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { FAKE_DEMUCS_KEY, FAKE_DEMUCS_URL, startFakeDemucs, toneWav } from "../lib/fake-demucs.mjs";

const demucs = await startFakeDemucs();
const admin = await user("Details admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const singer = await user("Details singer");

async function waitFor(songId, ready) {
  let body;
  for (let i = 0; i < 60; i++) {
    body = (await call(singer, "GET", `/song-versions/${songId}/stem-separations`)).body;
    if (ready(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`waited: ${JSON.stringify(body)}`);
}
async function upload(songId, name, bytes, extra = {}) {
  const form = new FormData();
  form.append("type", "AUDIO");
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  form.append("file", new Blob([bytes], { type: "audio/wav" }), name);
  return (await fetch(`${API}/song-versions/${songId}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${singer.bearer}` }, body: form })).json();
}
const filesOf = async (songId, multitrackId) => (await api(singer, "GET", `/song-versions/${songId}/attachments`)).filter((file) => file.multitrackId === multitrackId);

try {
  await call(admin, "PUT", "/admin/stem-separation", { apiUrl: FAKE_DEMUCS_URL, apiKey: FAKE_DEMUCS_KEY });
  const stemsRole = (await api(admin, "GET", "/admin/roles")).find((role) => role.builtIn === "STEM_SEPARATION");
  await call(admin, "PUT", `/admin/users/${singer.id}/roles`, { roleIds: [stemsRole.id, "role_audio_uploads"] });
  const song = await api(singer, "POST", "/song-versions", {
    title: `Details ${stamp}`,
    language: "en",
    artists: ["Band"],
    content: "{start_of_verse}\n[G]Hello\n{end_of_verse}\n{start_of_chorus}\n[C]World\n{end_of_chorus}\n{start_of_verse: Verse 2}\n[G]Again\n{end_of_verse}\n{chorus}\n",
    contentFormat: "CHORDPRO",
  });
  const [verse1, chorus, verse2] = (await api(singer, "GET", `/song-versions/${song.id}`)).documentJson.sections.map((section) => section.id);
  // A recording with a tempo of its own, nothing else.
  const recording = await upload(song.id, "Live mix.wav", toneWav(300, 2), { recordingTempo: "96" });

  // --- What the server found
  // Its beats and bars too (issue #299): 3/4 at 72 BPM from 0.5 s, a downbeat every three beats, after a free intro.
  const beats = Array.from({ length: 40 }, (_, i) => Math.round((0.5 + (i * 60) / 72) * 1000) / 1000);
  const downbeats = beats.filter((_, i) => i % 3 === 0);
  demucs.analysis.next = {
    tempo: { bpm: 72, confidence: 0.9 },
    first_beat: 0.5,
    beats,
    downbeats,
    beats_confidence: 0.8,
    intro_free: true,
    time_signature: { numerator: 3, denominator: 4, confidence: 0.8 },
    key: { name: "Em", confidence: 0.75 },
    sections: [
      { start: 0, label: "start" },
      { start: 2, label: "verse" },
      { start: 10, label: "chorus" },
      { start: 18, label: "verse" },
      { start: 26, label: "chorus" },
      { start: 34, label: "chorus" },
      { start: 40, label: "end" },
    ],
  };
  let r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "4" });
  let list = await waitFor(song.id, (body) => body.separations[0]?.status === "FAST_READY");
  const first = list.separations[0];
  check("the models it was sent with and the recording's name, kept", first.fastModel === "htdemucs" && first.hqModel === "htdemucs_ft" && first.sourceFilename === "Live mix.wav", JSON.stringify(first));
  let stems = await filesOf(song.id, first.multitrackId);
  const one = stems[0];
  check("named by its parts, in the asker's language; each file separated", stems.length === 4 && stems.every((file) => file.multitrackName === "Separated (4 parts)" && file.origin === "SEPARATED"), JSON.stringify(stems.map((file) => [file.multitrackName, file.origin])));
  check(
    "what the analysis found, where the recording had nothing: marked detected - its own tempo kept",
    one.recordingTempo === 96 && one.recordingKey === "Em" && one.recordingTimeSignature === "3/4" && one.recordingFirstBeat === 0.5 && one.detected.join() === "key,timeSignature,firstBeat,beats,sections",
    JSON.stringify({ tempo: one.recordingTempo, key: one.recordingKey, time: one.recordingTimeSignature, first: one.recordingFirstBeat, detected: one.detected }),
  );
  check(
    "the recording's beats and bars, on every stem, and its free intro (issue #299)",
    stems.every((file) => JSON.stringify(file.recordingBeats) === JSON.stringify(beats) && JSON.stringify(file.recordingDownbeats) === JSON.stringify(downbeats) && file.recordingFreeIntro === true),
    JSON.stringify({ beats: one.recordingBeats?.length, downbeats: one.recordingDownbeats?.length, free: one.recordingFreeIntro }),
  );
  check(
    "its sections placed on the song's: verse 1, the chorus, verse 2, the chorus (and once more)",
    JSON.stringify(one.cuePoints) === JSON.stringify([{ at: 2, sectionId: verse1 }, { at: 10, sectionId: chorus }, { at: 18, sectionId: verse2 }, { at: 26, sectionId: chorus }, { at: 34, sectionId: chorus }]),
    JSON.stringify(one.cuePoints),
  );

  // --- Confirmed, or changed
  r = await call(singer, "PATCH", `/song-versions/${song.id}/attachments/${one.id}`, { recordingKey: "G" });
  check("changing the key confirms it", r.status === 200 && r.body.recordingKey === "G" && r.body.detected.join() === "timeSignature,firstBeat,beats,sections", JSON.stringify(r.body.detected));
  r = await call(singer, "PATCH", `/song-versions/${song.id}/attachments/${stems[2].id}`, { recordingFirstBeat: 0.6 });
  check(
    "a first beat set by hand: the detected beats and bars no longer hold",
    r.status === 200 && r.body.recordingBeats.length === 0 && r.body.recordingDownbeats.length === 0 && !r.body.detected.includes("beats") && !r.body.detected.includes("firstBeat"),
    JSON.stringify({ beats: r.body.recordingBeats?.length, detected: r.body.detected }),
  );
  r = await call(singer, "PATCH", `/song-versions/${song.id}/attachments/${stems[1].id}`, { confirmDetected: true });
  check("or all of them, as they are", r.status === 200 && r.body.detected.length === 0 && r.body.recordingKey === "Em", JSON.stringify(r.body.detected));

  // --- Someone's recording into it: apart from the stems, and not replaced by the finer pass
  const take = await upload(song.id, "My vocals.wav", toneWav(440, 2), { stemPart: "VOCALS", multitrackId: first.multitrackId, process: "encode" });
  check("a recording made in Songverse says so", take.origin === "RECORDED" && take.multitrackId === first.multitrackId, JSON.stringify(take));
  await demucs.completeHq(sql(`select "jobId" from "StemSeparation" where id='${first.id}'`));
  list = await waitFor(song.id, (body) => body.separations[0]?.status === "COMPLETED");
  const after = await filesOf(song.id, first.multitrackId);
  check(
    "the finer pass replaced the stems, not the recording (issue #174)",
    list.separations[0].hqDone && after.some((file) => file.origin === "RECORDED" && file.stemPart === "VOCALS") && after.filter((file) => file.origin === "SEPARATED").length === 4 && after.filter((file) => file.stemPart === "VOCALS").length === 2,
    JSON.stringify(after.map((file) => [file.stemPart, file.origin])),
  );

  // --- Re-run as 6 parts, replacing these: their sections and name carry over, the recording moves
  const mine = [{ at: 1.5, sectionId: verse1 }, { at: 9, sectionId: chorus }];
  for (const file of after) await call(singer, "PATCH", `/song-versions/${song.id}/attachments/${file.id}`, { cuePoints: mine, multitrackName: `Live take ${stamp}` });
  demucs.analysis.next = null;
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "6", replace: true });
  check("asked to replace the earlier stems", r.status === 201 && r.body.replacesMultitrackId === first.multitrackId && r.body.hqRequested === false, JSON.stringify(r.body));
  list = await waitFor(song.id, (body) => body.separations[0]?.id === r.body.id && body.separations[0].status === "COMPLETED");
  const second = list.separations[0];
  check("the earlier multitrack is gone", (await filesOf(song.id, first.multitrackId)).length === 0);
  const now = await filesOf(song.id, second.multitrackId);
  const separated = now.filter((file) => file.origin === "SEPARATED");
  check(
    "6 new stems, with the sections and name given to the earlier ones",
    separated.length === 6 && separated.every((file) => file.multitrackName === `Live take ${stamp}` && JSON.stringify(file.cuePoints) === JSON.stringify(mine) && !file.detected.includes("sections")),
    JSON.stringify(separated.map((file) => [file.multitrackName, file.cuePoints, file.detected])),
  );
  check("the recording moved over with them", now.some((file) => file.origin === "RECORDED" && file.stemPart === "VOCALS" && file.multitrackName === `Live take ${stamp}`), JSON.stringify(now.map((file) => [file.stemPart, file.origin])));

  // --- The recording deleted: the list still names it
  await call(singer, "PATCH", `/song-versions/${song.id}/attachments/${recording.id}`, { locked: false });
  r = await call(singer, "DELETE", `/song-versions/${song.id}/attachments/${recording.id}`);
  list = (await call(singer, "GET", `/song-versions/${song.id}/stem-separations`)).body;
  check("a deleted recording still named in the list", r.status === 204 && list.separations.every((row) => row.sourceFilename === "Live mix.wav"), JSON.stringify(list.separations.map((row) => row.sourceFilename)));
} finally {
  await call(admin, "DELETE", "/admin/stem-separation");
  await demucs.close();
}

finish();
