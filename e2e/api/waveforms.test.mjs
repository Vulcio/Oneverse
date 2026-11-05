// Stored waveforms (issue #388): the Worker works out each audio file's
// waveform once - a level every 10 ms, a byte each, against its loudest -
// and GET …/attachments/waveforms lists those of the song's files the viewer
// sees, for the player to draw before the audio has arrived. Files with the
// same bytes share one; it goes with the last of them.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const owner = await user("Waveform owner");
const other = await user("Waveform stranger");

/** A mono 16-bit WAV at 8 kHz (128 kbps: kept as uploaded): a second of (near) silence, then a second of a 440 Hz tone at half scale. */
function wav() {
  const rate = 8000;
  const data = Buffer.alloc(rate * 2 * 2);
  for (let i = rate; i < rate * 2; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 16383), i * 2);
  // Bytes of this run's own: a file from an earlier run would share its waveform.
  data.writeInt16LE(1 + (stamp % 1000), 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function upload(songId, name) {
  const form = new FormData();
  form.append("type", "AUDIO");
  form.append("file", new Blob([wav()], { type: "audio/wav" }), name);
  const res = await fetch(`${API}/song-versions/${songId}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${owner.bearer}` }, body: form });
  return res.json();
}

/** The song's waveforms, once `count` are there (the Worker's a moment behind). */
async function waveforms(songId, count, timeout = 60000) {
  const until = Date.now() + timeout;
  for (;;) {
    const list = await api(owner, "GET", `/song-versions/${songId}/attachments/waveforms`);
    if (list.length >= count || Date.now() > until) return list;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const song = await api(owner, "POST", "/song-versions", { title: `Waveforms ${stamp}`, language: "en", artists: ["Someone"], content: "[G]Line\n", contentFormat: "CHORDPRO" });
const first = await upload(song.id, "Tone.wav");
check("uploaded as it is", first.processing === null, JSON.stringify(first.processing));

const [wave] = await waveforms(song.id, 1);
check("its waveform, worked out by the Worker", wave?.attachmentId === first.id, JSON.stringify(wave)?.slice(0, 200));
const peaks = Buffer.from(wave?.peaks ?? "", "base64");
check("a level every 10 ms: 2 s is 200 levels", wave?.rate === 100 && Math.abs(wave.seconds - 2) < 0.05 && Math.abs(peaks.length - 200) <= 1, `${wave?.rate} ${wave?.seconds} ${peaks.length}`);
check("its loudest: the tone at half scale", Math.abs(wave?.loudest - 0.5) < 0.05, String(wave?.loudest));
const quiet = Math.max(...peaks.subarray(5, 95));
const loud = Math.min(...peaks.subarray(105, 195));
check("silent for the first second, at its loudest for the next", quiet < 10 && loud > 230, `${quiet} ${loud}`);

// The same bytes again: listed at once, sharing the stored one.
const second = await upload(song.id, "Tone again.wav");
const both = await api(owner, "GET", `/song-versions/${song.id}/attachments/waveforms`);
check("a file with the same bytes shares it", both.length === 2 && both.some((one) => one.attachmentId === second.id && one.peaks === wave.peaks), JSON.stringify(both.map((one) => one.attachmentId)));
check("one stored waveform for both", sql(`select count(*) from "AudioWaveform" where "storageKey"=(select "storageKey" from "Attachment" where id='${first.id}')`) === "1");

// Someone who can't see the song can't read its waveforms.
const refused = await call(other, "GET", `/song-versions/${song.id}/attachments/waveforms`);
check("refused to someone who can't see the song", refused.status === 403 || refused.status === 404, String(refused.status));

// It goes once no file has those bytes.
const key = sql(`select "storageKey" from "Attachment" where id='${first.id}'`);
// Kept as uploaded (issue #145) until unlocked.
sql(`update "Attachment" set locked=false where id in ('${first.id}','${second.id}')`);
const removed = await call(owner, "DELETE", `/song-versions/${song.id}/attachments/${first.id}`);
check("kept while another file has the bytes", removed.status < 300 && sql(`select count(*) from "AudioWaveform" where "storageKey"='${key}'`) === "1");
const last = await call(owner, "DELETE", `/song-versions/${song.id}/attachments/${second.id}`);
check("gone with the last of them", last.status < 300 && sql(`select count(*) from "AudioWaveform" where "storageKey"='${key}'`) === "0");

finish();
