import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { NotFoundException } from "@nestjs/common";
import { Readable } from "node:stream";
import type { ByteRange, ObjectStorageDriver } from "./object-storage-driver.js";

/** A big file is sent in parts of this size. */
const PART_BYTES = 64 * 1024 * 1024;

const notFound = (error: unknown): never => {
  if (error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound")) {
    throw new NotFoundException("Object not found in storage");
  }
  throw error;
};

export interface S3StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  /** "auto" for R2; another provider's own (an organisation's bucket, issue #206). */
  region?: string;
  /** How long to wait to connect, and for an answer to go quiet (an organisation's bucket: PROVIDER_TIMEOUT_MS). */
  timeouts?: { connectMs: number; idleMs: number };
}

/**
 * R2 is S3-compatible, so the plain AWS SDK client works against it given
 * the account's R2 endpoint - no separate Cloudflare SDK needed.
 */
export class S3StorageDriver implements ObjectStorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region ?? "auto",
      ...(config.timeouts && { requestHandler: { connectionTimeout: config.timeouts.connectMs, requestTimeout: config.timeouts.idleMs }, maxAttempts: 2 }),
      endpoint: config.endpoint || `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async putObject(hash: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: hash, Body: body, ContentType: contentType }),
    );
  }

  /**
   * A file, streamed: in one request up to PART_BYTES, in parts above (S3
   * takes at most 5 GB in one, and R2 likes parts), each read from disk as
   * it's sent.
   */
  async putFile(hash: string, path: string, sizeBytes: number, contentType: string): Promise<void> {
    if (sizeBytes <= PART_BYTES) {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: hash, Body: createReadStream(path), ContentLength: sizeBytes, ContentType: contentType }));
      return;
    }
    const { UploadId } = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: hash, ContentType: contentType }));
    try {
      const parts: { ETag: string | undefined; PartNumber: number }[] = [];
      for (let start = 0, number = 1; start < sizeBytes; start += PART_BYTES, number += 1) {
        const end = Math.min(start + PART_BYTES, sizeBytes) - 1;
        const { ETag } = await this.client.send(
          new UploadPartCommand({ Bucket: this.bucket, Key: hash, UploadId, PartNumber: number, Body: createReadStream(path, { start, end }), ContentLength: end - start + 1 }),
        );
        parts.push({ ETag, PartNumber: number });
      }
      await this.client.send(new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: hash, UploadId, MultipartUpload: { Parts: parts } }));
    } catch (error) {
      await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: hash, UploadId })).catch(() => undefined);
      throw error;
    }
  }

  async getObject(hash: string): Promise<Buffer> {
    const result = await this.client
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: hash }))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "NoSuchKey") {
          throw new NotFoundException("Object not found in storage");
        }
        throw error;
      });
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new NotFoundException("Object not found in storage");
    return Buffer.from(bytes);
  }

  async streamObject(hash: string, range?: ByteRange): Promise<Readable> {
    const result = await this.client
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: hash, Range: range ? `bytes=${range.start}-${range.end}` : undefined }))
      .catch(notFound);
    // In Node the SDK's body is already a Readable.
    if (!(result.Body instanceof Readable)) throw new NotFoundException("Object not found in storage");
    return result.Body;
  }

  async objectSize(hash: string): Promise<number> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: hash })).catch(notFound);
    return result.ContentLength ?? 0;
  }

  async deleteObject(hash: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: hash }));
  }
}
