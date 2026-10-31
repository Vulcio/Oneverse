import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Where backups are written (issue #119): an S3-compatible bucket, or a folder (BACKUP_DIR). Keys are relative to the prefix. */
export interface BackupTarget {
  readonly description: string;
  put(key: string, body: Readable, size: number, contentType?: string): Promise<void>;
  get(key: string): Promise<Readable | null>;
  /** Every key under `prefix` (relative to the target's own prefix), with its size. */
  list(prefix: string): Promise<{ key: string; size: number }[]>;
  delete(key: string): Promise<void>;
}

export interface S3TargetConfig {
  endpoint: string | null;
  region: string | null;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const join_ = (prefix: string, key: string) => (prefix ? `${prefix.replace(/\/+$/, "")}/${key}` : key);

export class S3BackupTarget implements BackupTarget {
  private readonly client: S3Client;
  readonly description: string;

  constructor(private readonly config: S3TargetConfig) {
    this.client = new S3Client({
      region: config.region || "auto",
      ...(config.endpoint && { endpoint: config.endpoint }),
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // R2, B2, MinIO and S3 all take bucket-in-the-path addresses.
      forcePathStyle: true,
      // Checksums only where a provider requires them: several S3-compatible ones refuse the SDK's newer default.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    this.description = `s3://${config.bucket}/${config.prefix}`;
  }

  async put(key: string, body: Readable, size: number, contentType = "application/octet-stream"): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: join_(this.config.prefix, key), Body: body, ContentLength: size, ContentType: contentType }));
  }

  async get(key: string): Promise<Readable | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: join_(this.config.prefix, key) }));
      return result.Body instanceof Readable ? result.Body : null;
    } catch (error) {
      if (error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound")) return null;
      throw error;
    }
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    const full = join_(this.config.prefix, prefix);
    const strip = this.config.prefix ? this.config.prefix.replace(/\/+$/, "").length + 1 : 0;
    const out: { key: string; size: number }[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: full, ContinuationToken: token }));
      for (const item of page.Contents ?? []) if (item.Key) out.push({ key: item.Key.slice(strip), size: item.Size ?? 0 });
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: join_(this.config.prefix, key) }));
  }
}

/** A folder - a disk or a network share mounted on the Worker - for self-hosters without a second bucket. */
export class DirBackupTarget implements BackupTarget {
  readonly description: string;

  constructor(private readonly root: string) {
    this.description = root;
  }

  private path(key: string): string {
    const path = join(this.root, key);
    if (relative(this.root, path).startsWith("..")) throw new Error(`Key outside the backup folder: ${key}`);
    return path;
  }

  async put(key: string, body: Readable, _size?: number): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    // Written beside, then moved: a half-written file is never taken for a whole one.
    const partial = `${path}.partial`;
    await pipeline(body, createWriteStream(partial));
    await rename(partial, path);
  }

  async get(key: string): Promise<Readable | null> {
    const path = this.path(key);
    try {
      await stat(path);
    } catch {
      return null;
    }
    return createReadStream(path);
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    const out: { key: string; size: number }[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (!entry.name.endsWith(".partial")) {
          const key = relative(this.root, path).split(sep).join("/");
          if (key.startsWith(prefix)) out.push({ key, size: (await stat(path)).size });
        }
      }
    };
    await walk(this.root);
    return out;
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** A whole object read into memory: small ones only (the manifest, latest.json). */
export async function readAll(stream: Readable | null): Promise<Buffer | null> {
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

export function bufferStream(body: Buffer): Readable {
  return Readable.from([body]);
}
