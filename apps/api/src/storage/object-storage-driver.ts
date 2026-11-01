/**
 * A content-addressed blob store: objects are looked up and stored purely
 * by their SHA-256 hash (see docs/songbooks-and-catalog.md §8), so a
 * driver never needs to know about deduplication or reference counting -
 * that's handled one layer up, in AttachmentsService, against the
 * Attachment table. putObject() is idempotent by design: uploading a hash
 * that's already stored is safe to call again (and a driver may skip the
 * actual write when it already has the key).
 */
import type { Readable } from "node:stream";

/** Bytes `start` to `end`, both included (as HTTP's Range counts them). */
export interface ByteRange {
  start: number;
  end: number;
}

export interface ObjectStorageDriver {
  putObject(hash: string, body: Buffer, contentType: string): Promise<void>;
  /** An object from a file on disk, streamed rather than read whole (an archive, issue #351). */
  putFile(hash: string, path: string, sizeBytes: number, contentType: string): Promise<void>;
  getObject(hash: string): Promise<Buffer>;
  /**
   * The object (or part of it) as a stream, so a download never holds the
   * whole file in memory (issue #33).
   */
  streamObject(hash: string, range?: ByteRange): Promise<Readable>;
  /** The object's size in bytes. */
  objectSize(hash: string): Promise<number>;
  deleteObject(hash: string): Promise<void>;
}
