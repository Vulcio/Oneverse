import { NotFoundException } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { ByteRange, ObjectStorageDriver } from "./object-storage-driver.js";

/**
 * Dev/test fallback when R2 isn't configured (see StorageService) - a real
 * deployment always uses S3ObjectStorageDriver. Keyed by hash the same way,
 * one file per object, so dedup/reference-counting behavior is identical
 * either way.
 */
export class LocalDiskStorageDriver implements ObjectStorageDriver {
  constructor(private readonly rootDir: string) {}

  private pathFor(hash: string): string {
    return join(this.rootDir, hash);
  }

  async putObject(hash: string, body: Buffer): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.pathFor(hash), body);
  }

  async putFile(hash: string, path: string): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await copyFile(path, this.pathFor(hash));
  }

  async getObject(hash: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(hash));
    } catch {
      throw new NotFoundException("Object not found in storage");
    }
  }

  async streamObject(hash: string, range?: ByteRange): Promise<Readable> {
    await this.objectSize(hash);
    return createReadStream(this.pathFor(hash), range ? { start: range.start, end: range.end } : {});
  }

  async objectSize(hash: string): Promise<number> {
    try {
      return (await stat(this.pathFor(hash))).size;
    } catch {
      throw new NotFoundException("Object not found in storage");
    }
  }

  async deleteObject(hash: string): Promise<void> {
    await rm(this.pathFor(hash), { force: true });
  }
}
