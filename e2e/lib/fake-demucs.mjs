// A stand-in for Songverse Sonic, our Demucs API (issue #63; its API.md,
// v1.6), started by the suites that split recordings into stems, in their
// own process - more than one when a suite needs a team's own server too
// (issue #300: its own port and key): the
// health check, the models, jobs uploaded as multipart, their status, the
// stems to download (behind the X-API-Key), and signed webhooks. The fast
// pass is done almost at once; the HQ pass waits for the suite to call
// `completeHq(jobId)`, as the nightly window would. Its download_url values
// name another origin (a reverse proxy's), as a real one behind a proxy
// does: Songverse must fetch them from the address it was given.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

export const FAKE_DEMUCS_PORT = Number(process.env.FAKE_DEMUCS_PORT ?? 3998);
export const FAKE_DEMUCS_URL = `http://localhost:${FAKE_DEMUCS_PORT}`;
export const FAKE_DEMUCS_KEY = "fake-demucs-key";
const PUBLIC_ORIGIN = "https://demucs.example.invalid";

/** A mono 16-bit WAV of `seconds` of a tone. */
export function toneWav(frequency, seconds = 2, rate = 8000, level = 0.3) {
  const samples = seconds * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * level * 32767), 44 + i * 2);
  return buffer;
}

const STEMS = {
  htdemucs: ["vocals", "drums", "bass", "other"],
  htdemucs_ft: ["vocals", "drums", "bass", "other"],
  htdemucs_6s: ["vocals", "drums", "bass", "guitar", "piano", "other"],
};

export async function startFakeDemucs({ port = FAKE_DEMUCS_PORT, key = FAKE_DEMUCS_KEY } = {}) {
  const base = `http://localhost:${port}`;
  const jobs = new Map();
  const received = [];
  const webhooks = [];
  /** The analysis the server answers with (issue #175): a suite sets it; null for none. */
  const analysis = { next: null };
  let next = 1;

  const stage = (job, quality) => {
    const names = job.twoStems ? [job.twoStems, `no_${job.twoStems}`] : STEMS[quality === "fast" ? job.model : job.hqModel] ?? STEMS.htdemucs;
    return names.map((name) => ({ name: `${name}.wav`, download_url: `${PUBLIC_ORIGIN}/api/v1/jobs/${job.id}/files/${quality}/${name}.wav` }));
  };
  const view = (job) => ({
    id: job.id,
    status: job.status,
    source_name: job.filename,
    two_stems: job.twoStems,
    error: null,
    fast: { status: job.fast, model: job.model, device: "cpu", files: job.fast === "completed" ? stage(job, "fast") : [], r2: null },
    hq: { enabled: job.hqEnabled, status: job.hq, model: job.hqModel, device: "cpu", files: job.hq === "completed" ? stage(job, "hq") : [], r2: null },
    callback_configured: !!job.callbackUrl,
    // What it found in the recording (issue #175), once the fast pass is done, when a suite gave one.
    ...(job.fast === "completed" && analysis.next && { analysis: analysis.next }),
  });
  const notify = async (job, event) => {
    if (!job.callbackUrl) return;
    const body = JSON.stringify({ event, job_id: job.id, timestamp: new Date().toISOString(), job: view(job) });
    const signature = `sha256=${createHmac("sha256", job.secret ?? "").update(body).digest("hex")}`;
    const response = await fetch(job.callbackUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-Demucs-Signature": signature }, body }).catch(() => null);
    webhooks.push({ event, status: response?.status ?? 0 });
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/api/v1/health") return json(200, { status: "ok", service: "songverse-sonic", version: "1.6.0", queue_depth: 0, default_model: "htdemucs", hq_default_model: "htdemucs_ft", allowed_devices: ["cpu"] });
    if (req.headers["x-api-key"] !== key) return json(401, { detail: "Invalid API key" });
    if (url.pathname === "/api/v1/models") return json(200, { models: Object.keys(STEMS), default: "htdemucs", hq_default: "htdemucs_ft", devices: ["cpu"], default_device: "cpu" });
    if (url.pathname === "/api/v1/jobs" && req.method === "POST") {
      const form = await new Request(url, { method: "POST", headers: req.headers, body: req, duplex: "half" }).formData();
      const file = form.get("file");
      const job = {
        id: `job-${next++}`,
        filename: file?.name ?? "audio",
        model: form.get("model") ?? "htdemucs",
        twoStems: form.get("two_stems") || null,
        hqEnabled: form.get("hq_enabled") === "true",
        hqModel: form.get("hq_model") ?? "htdemucs_ft",
        callbackUrl: form.get("callback_url"),
        secret: form.get("callback_secret"),
        status: "queued",
        fast: "queued",
        hq: form.get("hq_enabled") === "true" ? "scheduled" : null,
      };
      if (!STEMS[job.model]) return json(400, { detail: `Unknown model ${job.model}` });
      received.push({ id: job.id, bytes: file ? (await file.arrayBuffer()).byteLength : 0, model: job.model, twoStems: job.twoStems, hqEnabled: job.hqEnabled, hqModel: job.hqModel, callbackUrl: job.callbackUrl });
      jobs.set(job.id, job);
      json(202, view(job));
      // The fast pass: done in a moment.
      setTimeout(() => {
        job.fast = "completed";
        job.status = job.hqEnabled ? "hq_scheduled" : "completed";
        void notify(job, "fast.completed");
      }, 300);
      return;
    }
    const files = /^\/api\/v1\/jobs\/([^/]+)\/files\/(fast|hq)\/([^/]+)\.wav$/.exec(url.pathname);
    if (files) {
      const job = jobs.get(files[1]);
      if (!job) return json(404, { detail: "Not found" });
      // Each stem its own tone; the HQ ones louder, to tell them apart.
      const tone = { vocals: 440, drums: 150, bass: 80, other: 660, guitar: 330, piano: 523, no_vocals: 220 }[files[3]] ?? 300;
      res.writeHead(200, { "Content-Type": "audio/wav" });
      return res.end(toneWav(tone, 2, 8000, files[2] === "hq" ? 0.6 : 0.3));
    }
    const status = /^\/api\/v1\/jobs\/([^/]+)$/.exec(url.pathname);
    if (status) {
      const job = jobs.get(status[1]);
      return job ? json(200, view(job)) : json(404, { detail: "Not found" });
    }
    json(404, { detail: "Not found" });
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return {
    url: base,
    key,
    received,
    webhooks,
    analysis,
    /** The HQ pass done, as the night would. */
    async completeHq(jobId, { fail = false } = {}) {
      const job = jobs.get(jobId);
      job.hq = fail ? "failed" : "completed";
      job.status = fail ? "fast_completed" : "completed";
      await notify(job, fail ? "hq.failed" : "hq.completed");
    },
    /** A webhook, forged: signed with the wrong secret. */
    async forge(callbackUrl, jobId) {
      const body = JSON.stringify({ event: "fast.completed", job_id: jobId });
      return (await fetch(callbackUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-Demucs-Signature": `sha256=${createHmac("sha256", "wrong").update(body).digest("hex")}` }, body })).status;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
