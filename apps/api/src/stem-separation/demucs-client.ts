import { PROVIDER_TIMEOUT_MS } from "../metadata/provider-timeout.js";
import type { EffectiveStemSeparationSettings } from "./stem-separation-settings.js";

/**
 * Our Demucs API (issue #63; its API.md, v1.3): asynchronous jobs, a fast
 * pass then an HQ pass in its nightly window, signed webhooks. Only ever
 * the address an admin set: it's usually on a private network, so it isn't
 * held to the outside-download rules (fetchProviderImage) that keep
 * private addresses out; a file's download_url is read only for its path,
 * fetched from that same address. A call waits PROVIDER_TIMEOUT_MS; a
 * file going there or coming back, TRANSFER_TIMEOUT_MS.
 */

const TRANSFER_TIMEOUT_MS = 10 * 60 * 1000;
/** A stem is a few minutes of WAV: this is well past any. */
export const MAX_STEM_BYTES = 1024 * 1024 * 1024;

export class DemucsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface DemucsFile {
  name: string;
  download_url: string;
}

export interface DemucsStage {
  status?: string;
  model?: string;
  files?: DemucsFile[];
}

/**
 * What the server found in the recording (issue #175), if it analyses them:
 * optional, each part too; a confidence from 0 to 1 where it gives one.
 */
export interface DemucsAnalysis {
  tempo?: { bpm?: number; confidence?: number } | null;
  first_beat?: number | null;
  /** Every beat and the first of each bar, in seconds (API v1.5, issue #299); with how sure it is of them, and whether the opening is free. */
  beats?: number[] | null;
  downbeats?: number[] | null;
  beats_confidence?: number | null;
  intro_free?: boolean | null;
  time_signature?: { numerator?: number; denominator?: number; confidence?: number } | null;
  key?: { name?: string; confidence?: number } | null;
  sections?: { start?: number; label?: string }[] | null;
}

export interface DemucsJob {
  id: string;
  status: "queued" | "fast_processing" | "hq_scheduled" | "hq_processing" | "completed" | "fast_completed" | "failed" | string;
  error?: string | null;
  fast?: DemucsStage;
  hq?: DemucsStage & { enabled?: boolean };
  analysis?: DemucsAnalysis | null;
}

type Configured = Pick<EffectiveStemSeparationSettings, "apiUrl" | "apiKey">;

function configured(settings: Configured): { apiUrl: string; apiKey: string } {
  if (!settings.apiUrl || !settings.apiKey) throw new DemucsError("Stem separation isn't set up: its API's address and key are in Admin > Stem separation");
  return { apiUrl: settings.apiUrl, apiKey: settings.apiKey };
}

async function call<T>(settings: Configured, path: string, init: RequestInit = {}, timeout = PROVIDER_TIMEOUT_MS): Promise<T> {
  const { apiUrl, apiKey } = configured(settings);
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), "X-API-Key": apiKey, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new DemucsError(name === "TimeoutError" ? "The Demucs API didn't answer in time" : `The Demucs API couldn't be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      if (parsed.detail !== undefined) detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail).slice(0, 300);
    } catch {
      // Not JSON: its text.
    }
    throw new DemucsError(response.status === 401 ? "The Demucs API refused the key" : `The Demucs API answered ${response.status}: ${detail}`, response.status);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Its health check (no key needed) and what it offers (the key checked): Admin's Test connection. */
export async function testDemucs(settings: Configured) {
  const { apiUrl } = configured(settings);
  let health: Record<string, unknown>;
  try {
    const response = await fetch(`${apiUrl}/api/v1/health`, { redirect: "error", signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    health = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    throw new DemucsError(`The Demucs API couldn't be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
  const models = await call<{ models: string[]; default: string; hq_default: string; devices: string[]; default_device: string }>(settings, "/api/v1/models");
  return { health, models };
}

/** A recording sent to it (multipart), its fast pass to run now and, if asked, its HQ pass in the window. */
export async function submitDemucsJob(
  settings: Configured,
  audio: Buffer,
  filename: string,
  mimeType: string,
  options: { model: string; twoStems?: string; hq?: { model: string }; callbackUrl?: string; callbackSecret?: string },
): Promise<DemucsJob> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
  form.append("model", options.model);
  if (options.twoStems) form.append("two_stems", options.twoStems);
  form.append("hq_enabled", options.hq ? "true" : "false");
  if (options.hq) form.append("hq_model", options.hq.model);
  if (options.callbackUrl && options.callbackSecret) {
    form.append("callback_url", options.callbackUrl);
    form.append("callback_secret", options.callbackSecret);
  }
  return call<DemucsJob>(settings, "/api/v1/jobs", { method: "POST", body: form }, TRANSFER_TIMEOUT_MS);
}

export function getDemucsJob(settings: Configured, jobId: string): Promise<DemucsJob> {
  return call<DemucsJob>(settings, `/api/v1/jobs/${encodeURIComponent(jobId)}`);
}

/** A result file, from the configured address whatever origin its download_url names (behind a proxy, its public one). */
export async function downloadDemucsFile(settings: Configured, file: DemucsFile): Promise<Buffer> {
  const { apiUrl, apiKey } = configured(settings);
  let path: string;
  try {
    path = new URL(file.download_url, apiUrl).pathname;
  } catch {
    throw new DemucsError(`A file with an address that isn't one: ${file.download_url}`);
  }
  if (!path.startsWith("/api/v1/jobs/")) throw new DemucsError(`A file somewhere unexpected: ${path}`);
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, { headers: { "X-API-Key": apiKey }, redirect: "error", signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS) });
  } catch (error) {
    throw new DemucsError(`${file.name} couldn't be downloaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok || !response.body) throw new DemucsError(`${file.name} couldn't be downloaded: ${response.status}`, response.status);
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_STEM_BYTES) throw new DemucsError(`${file.name} is larger than a stem can be`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > MAX_STEM_BYTES) throw new DemucsError(`${file.name} is larger than a stem can be`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
