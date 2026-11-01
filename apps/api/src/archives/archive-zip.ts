import { Unzip, UnzipInflate, Zip, ZipDeflate } from "fflate";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

/** A folder of its own for a job's files, removed by `cleanUp()`. */
export async function workFolder(): Promise<{ path: string; cleanUp: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), "oneverse-archive-"));
  return { path, cleanUp: () => rm(path, { recursive: true, force: true }) };
}

function waitFor(stream: WriteStream): Promise<void> {
  return stream.writableNeedDrain ? new Promise((resolve, reject) => stream.once("drain", resolve).once("error", reject)) : Promise.resolve();
}

function closed(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(() => resolve());
  });
}

/**
 * Writes a zip to a file as it's made (issue #351), never holding it whole:
 * the stored files, often audio, are streamed in uncompressed (they don't
 * shrink), the JSON compressed. The archive's hash is taken as it's written.
 */
export class ArchiveWriter {
  private readonly out: WriteStream;
  private readonly hash = createHash("sha256");
  private size = 0;
  private failure: Error | null = null;
  private readonly done: Promise<void>;
  private readonly zip: Zip;

  constructor(readonly path: string) {
    this.out = createWriteStream(path);
    let finish!: () => void;
    this.done = new Promise((resolve) => (finish = resolve));
    this.zip = new Zip((error, chunk, final) => {
      if (error) this.failure = error;
      else {
        this.hash.update(chunk);
        this.size += chunk.length;
        this.out.write(chunk);
      }
      if (final || error) finish();
    });
  }

  private check() {
    if (this.failure) throw this.failure;
  }

  async addText(name: string, value: string): Promise<void> {
    const entry = new ZipDeflate(name, { level: 6 });
    this.zip.add(entry);
    entry.push(new TextEncoder().encode(value), true);
    this.check();
    await waitFor(this.out);
  }

  addJson(name: string, value: unknown): Promise<void> {
    return this.addText(name, JSON.stringify(value, null, 1));
  }

  /** A stored file, streamed in as it's read. */
  async addStream(name: string, body: Readable): Promise<number> {
    // Level 0: kept as it is, in deflate's stored blocks, which any unzip (and ours, streaming) reads back.
    const entry = new ZipDeflate(name, { level: 0 });
    this.zip.add(entry);
    let bytes = 0;
    for await (const chunk of body as AsyncIterable<Buffer>) {
      bytes += chunk.length;
      entry.push(chunk);
      this.check();
      await waitFor(this.out);
    }
    entry.push(new Uint8Array(0), true);
    this.check();
    await waitFor(this.out);
    return bytes;
  }

  /** Finishes the zip: its hash and size. */
  async finish(): Promise<{ sha256: string; sizeBytes: number }> {
    this.zip.end();
    await this.done;
    this.check();
    await closed(this.out);
    return { sha256: this.hash.digest("hex"), sizeBytes: this.size };
  }

  async abort(): Promise<void> {
    this.zip.terminate();
    await closed(this.out).catch(() => undefined);
  }
}

export interface ReadFile {
  /** Where it was written, in the work folder. */
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface ReadOptions {
  /** The entries to keep in memory, parsed as JSON. */
  json: ReadonlySet<string>;
  /** Whether to keep a file entry (written to the work folder, hashed). */
  wantsFile: (name: string) => boolean;
  /** Called once each kept file is written; awaited before the archive is read on. */
  onFile: (name: string, file: ReadFile) => Promise<void>;
  folder: string;
  /** The most it may unpack to, all entries together: a zip bomb stops there. */
  maxBytes: number;
  maxJsonBytes?: number;
}

/**
 * Reads an archive as it streams in (issue #351): its JSON entries kept, its
 * files written one by one to the work folder with their hash. Anything else
 * in it is skipped. Throws on what isn't a zip, or unpacks to too much.
 */
export async function readArchive(body: Readable, options: ReadOptions): Promise<Map<string, unknown>> {
  const maxJson = options.maxJsonBytes ?? 512 * 1024 * 1024;
  const json = new Map<string, unknown>();
  const finished: { name: string; file: ReadFile; written: Promise<void> }[] = [];
  const open: WriteStream[] = [];
  let total = 0;
  let failure: Error | null = null;

  const unzip = new Unzip((entry) => {
    const name = entry.name;
    if (options.json.has(name)) {
      const parts: Uint8Array[] = [];
      let size = 0;
      entry.ondata = (error, data, final) => {
        if (error) return void (failure = error);
        size += data.length;
        total += data.length;
        if (size > maxJson || total > options.maxBytes) return void (failure ??= new Error("The archive is bigger than it can be"));
        parts.push(data);
        if (final) {
          try {
            json.set(name, JSON.parse(Buffer.concat(parts).toString("utf8")));
          } catch {
            failure ??= new Error(`${name} in the archive isn't JSON`);
          }
        }
      };
      entry.start();
    } else if (options.wantsFile(name)) {
      const path = join(options.folder, randomUUID());
      const out = createWriteStream(path);
      open.push(out);
      const hash = createHash("sha256");
      let size = 0;
      entry.ondata = (error, data, final) => {
        if (error) return void (failure = error);
        size += data.length;
        total += data.length;
        if (total > options.maxBytes) return void (failure ??= new Error("The archive is bigger than it can be"));
        hash.update(data);
        out.write(data);
        if (final) {
          open.splice(open.indexOf(out), 1);
          finished.push({ name, file: { path, sha256: hash.digest("hex"), sizeBytes: size }, written: closed(out) });
        }
      };
      entry.start();
    }
  });
  unzip.register(UnzipInflate);

  const settle = async () => {
    if (failure) throw failure;
    for (const stream of open) await waitFor(stream);
    while (finished.length > 0) {
      const { name, file, written } = finished.shift()!;
      await written;
      await options.onFile(name, file);
    }
  };

  let any = false;
  for await (const chunk of body as AsyncIterable<Buffer>) {
    any = true;
    try {
      unzip.push(chunk);
    } catch (error) {
      throw new Error(`This isn't a zip archive (${error instanceof Error ? error.message : String(error)})`, { cause: error });
    }
    await settle();
  }
  if (!any) throw new Error("The archive is empty");
  try {
    unzip.push(new Uint8Array(0), true);
  } catch (error) {
    throw new Error(`This isn't a zip archive (${error instanceof Error ? error.message : String(error)})`, { cause: error });
  }
  await settle();
  return json;
}
