// Checking what a separation's analysis found (issue #452), against the fake
// Sonic: how sure it was and what else each detail might be kept on the
// stems, a value too unsure to use offered rather than set; the stems'
// recording analysed again with what someone picked (an analysis-only job
// with hints, Sonic API 1.11), its answer written on the same stems - what
// they said is theirs, what they had confirmed sent along and kept - never
// counted as a separation; refused where it can't be.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { FAKE_DEMUCS_KEY, FAKE_DEMUCS_URL, startFakeDemucs, toneWav } from "../lib/fake-demucs.mjs";

const demucs = await startFakeDemucs();
const admin = await user("Check admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const singer = await user("Check singer");
const listener = await user("Check listener");

async function waitFor(songId, ready) {
  let body;
  for (let i = 0; i < 60; i++) {
    body = (await call(singer, "GET", `/song-versions/${songId}/stem-separations`)).body;
    if (ready(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`waited: ${JSON.stringify(body)}`);
}
const filesOf = async (songId, multitrackId) => (await api(singer, "GET", `/song-versions/${songId}/attachments`)).filter((file) => file.multitrackId === multitrackId);
// Beats from `first` at `bpm`, a bar every `per` beats.
const grid = (bpm, first, per, count) => {
  const beats = Array.from({ length: count }, (_, i) => Math.round((first + (i * 60) / bpm) * 1000) / 1000);
  return { beats, downbeats: beats.filter((_, i) => i % per === 0) };
};

try {
  await call(admin, "PUT", "/admin/stem-separation", { apiUrl: FAKE_DEMUCS_URL, apiKey: FAKE_DEMUCS_KEY, monthlyLimit: 1 });
  const stemsRole = (await api(admin, "GET", "/admin/roles")).find((role) => role.builtIn === "STEM_SEPARATION");
  await call(admin, "PUT", `/admin/users/${singer.id}/roles`, { roleIds: [stemsRole.id, "role_audio_uploads"] });
  const song = await api(singer, "POST", "/song-versions", { title: `Check ${stamp}`, language: "en", artists: ["Band"], content: "{c: Verse}\n[G]Hello\n", contentFormat: "CHORDPRO" });
  const form = new FormData();
  form.append("type", "AUDIO");
  form.append("visibility", "SONG");
  form.append("file", new Blob([toneWav(300, 2)], { type: "audio/wav" }), "Six eight.wav");
  const recording = await (await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${singer.bearer}` }, body: form })).json();

  // --- Heard as 3/4 at 71, not sure of the key: what it nearly picked comes too
  const threeFour = grid(71, 0.37, 3, 30);
  demucs.analysis.next = {
    tempo: { bpm: 71, confidence: 0.6 },
    time_signature: { numerator: 3, denominator: 4, confidence: 0.55 },
    key: { name: "Bb", confidence: 0.3 },
    first_beat: 0.37,
    ...threeFour,
    beats_confidence: 0.7,
    alternatives: {
      tempo: [{ bpm: 142, score: 0.4 }],
      time_signature: [
        { numerator: 4, denominator: 4, score: 0.2 },
        { numerator: 6, denominator: 8, score: 0.5 },
      ],
      first_beat: [{ start: 1.215, score: 0.3 }],
      key: [{ name: "Eb", score: 0.25 }],
    },
  };
  await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "2" });
  let list = await waitFor(song.id, (body) => body.separations[0]?.status !== "QUEUED" && body.separations[0]?.status !== "SUBMITTED");
  const separation = list.separations[0];
  let stems = await filesOf(song.id, separation.multitrackId);
  const stem = stems[0];
  check(
    "how sure it was, on every stem, and what else each might be, the likeliest first",
    stems.length === 2 &&
      stems.every((file) => JSON.stringify(file.recordingAnalysis) === JSON.stringify(stem.recordingAnalysis)) &&
      stem.recordingAnalysis?.confidence?.timeSignature === 0.55 &&
      stem.recordingAnalysis.confidence.beats === 0.7 &&
      stem.recordingAnalysis.alternatives.timeSignature.map((one) => one.value).join() === "6/8,4/4" &&
      stem.recordingAnalysis.alternatives.tempo[0].value === 142 &&
      stem.recordingAnalysis.alternatives.firstBeat[0].value === 1.215,
    JSON.stringify(stem.recordingAnalysis),
  );
  check(
    "a key too unsure to use: left out, offered first",
    stem.recordingKey === null && !stem.detected.includes("key") && stem.recordingAnalysis.alternatives.key.map((one) => one.value).join() === "Bb,Eb",
    JSON.stringify({ key: stem.recordingKey, alternatives: stem.recordingAnalysis.alternatives.key }),
  );
  check("the rest set, detected", stem.recordingTimeSignature === "3/4" && stem.recordingTempo === 71 && stem.detected.join() === "tempo,timeSignature,firstBeat,beats", JSON.stringify(stem.detected));

  // --- Refused
  let r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${stem.id}/analyse`, {});
  check("nothing said: refused", r.status === 400 && /at least one/.test(String(r.body.message)), JSON.stringify(r.body));
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${stem.id}/analyse`, { timeSignature: "5/3" });
  check("a time signature that isn't one: refused", r.status === 400 && /timeSignature/.test(String(r.body.message)), JSON.stringify(r.body));
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/analyse`, { timeSignature: "6/8" });
  check("the recording itself, not a separation's stem: refused", r.status === 400 && /separation's stems/.test(String(r.body.message)), JSON.stringify(r.body));
  r = await call(listener, "POST", `/song-versions/${song.id}/attachments/${stem.id}/analyse`, { timeSignature: "6/8" });
  check("someone who can't split it: refused", r.status === 403 || r.status === 404, `${r.status}`);

  // --- 6/8 picked: asked again, not separated, answered on the same stems
  const sixEight = grid(142, 0.37, 6, 60);
  demucs.analysis.next = {
    ...demucs.analysis.next,
    tempo: { bpm: 142, confidence: 0.8 },
    ...sixEight,
    beats_confidence: 0.75,
    alternatives: { tempo: [{ bpm: 71, score: 0.5 }], key: [{ name: "Eb", score: 0.25 }] },
  };
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${stem.id}/analyse`, { timeSignature: "6/8" });
  check(
    "asked again: not a separation, with what was picked - over the monthly limit of 1 all the same",
    r.status === 201 && r.body.analysisOnly === true && r.body.hints?.timeSignature === "6/8" && r.body.multitrackId === separation.multitrackId,
    JSON.stringify(r.body),
  );
  list = await waitFor(song.id, (body) => body.separations[0]?.status === "COMPLETED");
  const sent = demucs.received.at(-1);
  check("sent as an analysis-only job, with its hints and the song's words", sent.separate === false && sent.hints?.time_signature === "6/8" && Object.keys(sent.hints).length === 1 && sent.lyrics?.includes("Hello"), JSON.stringify(sent));
  stems = await filesOf(song.id, separation.multitrackId);
  const after = stems[0];
  check("no new stems", stems.length === 2 && stems.every((file) => file.origin === "SEPARATED"), JSON.stringify(stems.map((file) => file.filename)));
  check(
    "6/8 theirs, the tempo and beats found again in it, still to check",
    stems.every((file) => file.recordingTimeSignature === "6/8" && file.recordingTempo === 142 && file.recordingDownbeats.length === 10 && file.recordingBeats.length === 60) &&
      after.detected.join() === "tempo,firstBeat,beats" &&
      after.recordingAnalysis.hints?.timeSignature === "6/8" &&
      after.recordingAnalysis.confidence.timeSignature === 1,
    JSON.stringify({ time: after.recordingTimeSignature, tempo: after.recordingTempo, bars: after.recordingDownbeats.length, detected: after.detected, check: after.recordingAnalysis }),
  );

  // --- Confirmed, then another tempo: what they confirmed goes too
  await call(singer, "PATCH", `/song-versions/${song.id}/attachments/${after.id}`, { confirmDetected: true });
  await call(singer, "PATCH", `/song-versions/${song.id}/attachments/${stems[1].id}`, { confirmDetected: true });
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${after.id}/analyse`, { tempo: 140 });
  await waitFor(song.id, (body) => body.separations[0]?.id === r.body.id && body.separations[0].status === "COMPLETED");
  const again = demucs.received.at(-1).hints;
  check("its confirmed bar 1 and time signature sent along", again?.bpm === 140 && again.first_beat === 0.37 && again.time_signature === "6/8", JSON.stringify(again));
  const kept = (await filesOf(song.id, separation.multitrackId))[0];
  check("all three theirs now: nothing new to check but the beats", kept.recordingTempo === 140 && kept.recordingTimeSignature === "6/8" && kept.recordingFirstBeat === 0.37 && kept.detected.join() === "beats", JSON.stringify({ tempo: kept.recordingTempo, detected: kept.detected }));

  // --- A server that can't: the job fails, saying so, and nothing changes
  demucs.offers.hints = false;
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${after.id}/analyse`, { firstBeat: 1.2 });
  list = await waitFor(song.id, (body) => body.separations[0]?.id === r.body.id && body.separations[0].status === "FAILED");
  check("a server before 1.11: failed, saying why, nothing sent", /version 1.11/.test(list.separations[0].error) && demucs.received.at(-1).hints?.bpm === 140, list.separations[0].error);
  check("the stems as they were", (await filesOf(song.id, separation.multitrackId))[0].recordingFirstBeat === 0.37);
} finally {
  await call(admin, "DELETE", "/admin/stem-separation");
  await demucs.close();
}
finish();
