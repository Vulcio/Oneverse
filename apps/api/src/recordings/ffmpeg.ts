import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encodeWav } from "@oneverse/core";

/**
 * ffmpeg, for a recorded take (issue #127): run in the Worker, on files
 * in a temporary folder. A take's start is what lines it up with the rest
 * of its multitrack, so nothing here may move it: the silence trimmed is
 * the silence after the end, and a filter that delays the sound (the
 * noise reduction) has its delay measured and taken off.
 */

const FFMPEG = "ffmpeg";
/** A take is a few minutes of audio at most: a run that takes longer than this has hung. */
const RUN_TIMEOUT_MS = 5 * 60 * 1000;

export class FfmpegMissingError extends Error {
  constructor() {
    super("ffmpeg isn't installed where the background jobs run: recordings stay as WAV");
  }
}

/** Runs ffmpeg; resolves with what it wrote to stdout and stderr. */
export function runFfmpeg(args: string[], input?: Buffer): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-nostdin", ...args], { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
      // Only the end matters (the error, or loudnorm's measurements).
      err = (err + chunk.toString()).slice(-20000);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(error.code === "ENOENT" ? new FfmpegMissingError() : error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`ffmpeg failed (${code ?? "killed"}): ${err.trim().split("\n").slice(-3).join(" ")}`));
    });
    if (input && child.stdin) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    }
  });
}

/** ffmpeg's version ("7.1.1"), or null when it isn't installed: for Admin. */
export async function ffmpegVersion(): Promise<string | null> {
  try {
    const { stdout } = await runFfmpeg(["-version"]);
    return /ffmpeg version (\S+)/.exec(stdout.toString())?.[1] ?? "unknown";
  } catch {
    return null;
  }
}

/** Trailing silence, trimmed down to 0.3 s: reversed, so only the end is looked at. */
const TRIM_END = "areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.3,areverse";
// afftdn: spectral noise reduction, for steady noise; gentle (12 dB), so the music is left alone.
const DENOISE_OPTIONS = "nr=12:nf=-40";
const DENOISE = `afftdn=${DENOISE_OPTIONS}:tn=1`;
const LOUDNESS = "I=-16:TP=-1.5:LRA=11";

// arnndn: RNNoise (issue #132), a voice's clean-up - for speech and singing, not instruments.
const VOICE_MODEL = fileURLToPath(new URL("../../assets/rnnoise/bd.rnnn", import.meta.url));
const VOICE = `arnndn=m=${VOICE_MODEL}`;

/**
 * How late a filter makes the sound (samples), at `sampleRate`: a burst
 * half a second into a quiet file, found again after it. `otherwise` when
 * it can't be found (the filter took it for noise).
 */
export async function filterDelay(filter: string, sampleRate: number, otherwise = 0): Promise<number> {
  const samples = new Float32Array(sampleRate * 2);
  let seed = 1;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 16807) % 2147483647;
    samples[i] = (seed / 2147483647 - 0.5) * 0.006;
  }
  const at = sampleRate / 2;
  for (let i = 0; i < sampleRate / 100; i++) samples[at + i] = 0.6 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
  const { stdout } = await runFfmpeg(["-f", "wav", "-i", "pipe:0", "-af", filter, "-f", "s16le", "-ac", "1", "pipe:1"], Buffer.from(encodeWav(samples, sampleRate)));
  const pcm = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  let peak = 0;
  for (const value of pcm) peak = Math.max(peak, Math.abs(value));
  const found = peak > 1000 ? pcm.findIndex((value) => Math.abs(value) > peak * 0.3) : -1;
  return found < 0 ? otherwise : Math.max(0, found - at);
}

/** A WAV file's sample rate, from its header. */
export function wavSampleRate(wav: Buffer): number | null {
  return wav.length >= 44 && wav.toString("ascii", 0, 4) === "RIFF" && wav.toString("ascii", 8, 12) === "WAVE" ? wav.readUInt32LE(24) : null;
}

export interface TakeProcessing {
  /** Even out the level: EBU R128 loudness normalisation, measured first (two passes). */
  level: boolean;
  /** Reduce steady background noise (hiss, hum, a fan). */
  noise: boolean;
  /** Clean up a voice with RNNoise (issue #132). */
  voice?: boolean;
  /**
   * How long the take is quiet at its start (s): the count-in, before its
   * first beat. The room's noise is learnt from it - better than guessing,
   * for music - when there's enough (0.4 s); otherwise it's followed as the
   * take goes.
   */
  quietFor?: number | null;
}

/**
 * A take as the browser recorded it (WAV) turned into Ogg Opus, mono,
 * 96 kbps: its trailing silence trimmed, its noise reduced and level
 * evened out if asked. Its start stays where it was, to the sample.
 */
export async function processTake(audio: Buffer, dir: string, options: TakeProcessing): Promise<Buffer> {
  const { writeFile, readFile } = await import("node:fs/promises");
  const input = `${dir}/take.wav`;
  const output = `${dir}/take.opus`;
  // A file processed afterwards (Opus, MP3…) is read as WAV first, its channels kept.
  let wav = audio;
  if (!wavSampleRate(audio)) {
    await writeFile(`${dir}/source`, audio);
    await runFfmpeg(["-y", "-i", `${dir}/source`, "-c:a", "pcm_s16le", "-f", "wav", input]);
    wav = await readFile(input);
  } else {
    await writeFile(input, wav);
  }
  const sampleRate = wavSampleRate(wav);
  if (!sampleRate) throw new Error("Not a WAV file");
  const channels = Math.max(1, Math.min(2, wav.readUInt16LE(22)));
  const filters = [TRIM_END];
  // Each filter that delays the sound has its delay taken off: the take starts where it did.
  const undelay = (samples: number) => (samples > 0 ? [`atrim=start_sample=${samples}`, "asetpts=PTS-STARTPTS"] : []);
  if (options.voice) {
    // RNNoise works in 10 ms frames: that, if its delay can't be measured.
    filters.push(VOICE, ...undelay(await filterDelay(VOICE, sampleRate, Math.round(sampleRate / 100))));
  }
  if (options.noise) {
    const delay = await filterDelay(DENOISE, sampleRate);
    const quiet = Math.min(options.quietFor ?? 0, 3) - 0.1;
    // The noise learnt from the count-in (a moment in, and before the first beat), else tracked.
    if (quiet >= 0.3) filters.push(`asendcmd=c='0.05 afftdn@dn sample_noise start; ${quiet.toFixed(3)} afftdn@dn sample_noise stop'`, `afftdn@dn=${DENOISE_OPTIONS}`);
    else filters.push(DENOISE);
    filters.push(...undelay(delay));
  }
  if (options.level) {
    const { stderr } = await runFfmpeg(["-i", input, "-af", [...filters, `loudnorm=${LOUDNESS}:print_format=json`].join(","), "-f", "null", "-"]);
    const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(stderr)?.[0];
    const measured = json ? (JSON.parse(json) as Record<string, string>) : null;
    // Silence (or too short to measure) gives -inf: nothing to even out.
    if (measured && Number.isFinite(Number(measured.input_i))) {
      filters.push(
        `loudnorm=${LOUDNESS}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`,
      );
    }
  }
  // Mono at 96 kbps (a recorded take); a stereo file stays stereo, at 160.
  const encode = (chain: string[]) =>
    runFfmpeg(["-y", "-i", input, "-af", chain.join(",") || "anull", "-ar", "48000", "-ac", String(channels), "-c:a", "libopus", "-b:a", channels === 1 ? "96k" : "160k", "-f", "ogg", output]);
  // A take that's silence throughout is trimmed to nothing - an Opus file no
  // browser can play, if the encoder makes one at all: kept as long as it was, untrimmed.
  const trimmed = await encode(filters).then(
    () => true,
    () => false,
  );
  if (!trimmed || (await audioSeconds(output)) < 0.05) {
    await encode(filters.filter((filter) => filter !== TRIM_END));
    if ((await audioSeconds(output)) < 0.05) throw new Error("The take has no sound in it");
  }
  return readFile(output);
}

/**
 * A separated stem (issue #63) made Opus, as it is: nothing trimmed or
 * filtered - its start is where the recording's is, like every other part
 * of its multitrack - stereo at 160 kbps (mono at 96).
 */
export async function encodeStem(audio: Buffer, dir: string): Promise<Buffer> {
  const { writeFile, readFile } = await import("node:fs/promises");
  const input = `${dir}/stem-in`;
  const output = `${dir}/stem.opus`;
  await writeFile(input, audio);
  const channels = wavSampleRate(audio) ? Math.max(1, Math.min(2, audio.readUInt16LE(22))) : 2;
  await runFfmpeg(["-y", "-i", input, "-ar", "48000", "-ac", String(channels), "-c:a", "libopus", "-b:a", channels === 1 ? "96k" : "160k", "-f", "ogg", output]);
  return readFile(output);
}

/** Above this (bits a second, its size over its length), an uploaded audio file is made Opus (issue #182): a WAV, FLAC or AIFF. */
export const MAX_UPLOAD_BITRATE = 320_000;

/**
 * An audio file's length (s), channels and codec ("pcm_s24le", "flac",
 * "mp3"), read by ffprobe from its header - not decoded through. Null when
 * it can't be read.
 */
export async function probeAudio(file: string): Promise<{ seconds: number; channels: number; codec: string } | null> {
  const stdout = await new Promise<string | null>((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "format=duration:stream=channels,codec_name", "-of", "json", file], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : null);
    });
  });
  if (!stdout) return null;
  try {
    const json = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { channels?: number; codec_name?: string }[] };
    let seconds = Number(json.format?.duration);
    // A header that doesn't say (a FLAC written to a pipe): decoded through to find out.
    if (!Number.isFinite(seconds) || seconds <= 0) seconds = await audioSeconds(file);
    if (!(seconds > 0)) return null;
    return { seconds, channels: json.streams?.[0]?.channels ?? 2, codec: json.streams?.[0]?.codec_name ?? "" };
  } catch {
    return null;
  }
}

/**
 * An uploaded file made Opus (issue #182), as it is: nothing trimmed or
 * filtered, so it still lines up with its multitrack - stereo at 160 kbps
 * (mono at 96), as a separated stem.
 */
export async function encodeUpload(audio: Buffer, dir: string, channels: number): Promise<Buffer> {
  const { writeFile, readFile } = await import("node:fs/promises");
  const input = `${dir}/upload-in`;
  const output = `${dir}/upload.opus`;
  await writeFile(input, audio);
  const mono = channels === 1;
  await runFfmpeg(["-y", "-i", input, "-vn", "-ar", "48000", "-ac", mono ? "1" : "2", "-c:a", "libopus", "-b:a", mono ? "96k" : "160k", "-f", "ogg", output]);
  return readFile(output);
}

/** A codec that loses nothing (issue #182): its file is worth keeping as the original. */
export function isLosslessCodec(codec: string): boolean {
  return codec.startsWith("pcm_") || ["flac", "alac", "wavpack", "tta", "ape", "mlp", "truehd"].includes(codec);
}

/**
 * A lossless file as FLAC (issue #182), the original kept beside its Opus
 * copy: the same sample rate, channels and bit depth (FLAC holds integers:
 * a floating-point WAV becomes 24-bit). A FLAC file is kept as it is.
 */
export async function losslessOriginal(audio: Buffer, dir: string, codec: string): Promise<Buffer> {
  if (codec === "flac" && audio.subarray(0, 4).toString("latin1") === "fLaC") return audio;
  const { writeFile, readFile } = await import("node:fs/promises");
  const input = `${dir}/original-in`;
  const output = `${dir}/original.flac`;
  await writeFile(input, audio);
  const float = /^pcm_f(32|64)/.test(codec);
  await runFfmpeg(["-y", "-i", input, "-map", "0:a:0", "-c:a", "flac", "-compression_level", "8", ...(float ? ["-sample_fmt", "s32", "-bits_per_raw_sample", "24"] : []), "-f", "flac", output]);
  return readFile(output);
}

/** How long an audio file lasts (s), as ffmpeg reads it through. */
export async function audioSeconds(file: string): Promise<number> {
  // An Ogg file with no audio in it can't even be opened: none.
  const stderr = await runFfmpeg(["-i", file, "-f", "null", "-"]).then(
    (result) => result.stderr,
    () => "",
  );
  const times = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = times[times.length - 1];
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
}
