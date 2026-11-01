import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BINNED_TOO, type StorageSettings } from "@oneverse/db";
import { decryptSecret, encryptSecret, maskSecret } from "@oneverse/secret-crypto";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocalDiskStorageDriver } from "./local-disk-storage.driver.js";
import type { ByteRange, ObjectStorageDriver } from "./object-storage-driver.js";
import type { Readable } from "node:stream";
import { S3StorageDriver } from "./s3-storage.driver.js";
import { ownStorageDriver } from "./own-storage.js";

/** Where an object is: the server's storage (null), or an organisation's own bucket by its id (issue #206). */
export type StorageLocation = string | null;

export interface StoredObject {
  hash: string;
  sizeBytes: number;
}

export type StorageDriverName = "s3" | "local";
/** Where the active config came from - shown in the admin Storage panel. */
export type StorageConfigSource = "database" | "env" | "none";

export interface StorageConfigSummary {
  source: StorageConfigSource;
  driver: StorageDriverName;
  hasDatabaseConfig: boolean;
  accountId: string | null;
  accessKeyIdMasked: string | null;
  bucket: string | null;
  endpoint: string | null;
}

export interface SaveStorageConfigInput {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  endpoint?: string;
}

const SINGLETON_ID = "singleton";

function hasCompleteDbCredentials(
  settings: StorageSettings | null,
): settings is StorageSettings & { r2AccountId: string; r2AccessKeyId: string; r2SecretAccessKeyEnc: string; r2Bucket: string } {
  return !!(settings?.r2AccountId && settings.r2AccessKeyId && settings.r2SecretAccessKeyEnc && settings.r2Bucket);
}

/**
 * Content-addressed object storage (docs/songbooks-and-catalog.md §8):
 * objects are keyed by SHA-256, so re-uploading identical bytes resolves
 * to the same key for free - dedup is a property of the key, not
 * something this service tracks itself.
 *
 * Credentials resolve in this order, freshly on every call rather than
 * cached: admin-managed settings in the database (see StorageSettings),
 * then the R2_* env vars, then local disk. Re-resolving every time (one
 * cheap indexed lookup) instead of caching in memory is deliberate - the
 * API and Worker are separate processes (see Deploy.md), so an in-memory
 * cache in one would go stale the moment an admin updates settings
 * through the other, with no cross-process invalidation to fix it.
 */
@Injectable()
export class StorageService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private loadDbSettings(): Promise<StorageSettings | null> {
    return this.prisma.client.storageSettings.findUnique({ where: { id: SINGLETON_ID } });
  }

  private async resolveDriver(): Promise<{ driver: ObjectStorageDriver; name: StorageDriverName; source: StorageConfigSource }> {
    const dbSettings = await this.loadDbSettings();
    if (hasCompleteDbCredentials(dbSettings)) {
      const secretAccessKey = decryptSecret(dbSettings.r2SecretAccessKeyEnc, this.config.get<string>("SETTINGS_ENCRYPTION_KEY"));
      return {
        driver: new S3StorageDriver({
          accountId: dbSettings.r2AccountId,
          accessKeyId: dbSettings.r2AccessKeyId,
          secretAccessKey,
          bucket: dbSettings.r2Bucket,
          endpoint: dbSettings.r2Endpoint ?? undefined,
        }),
        name: "s3",
        source: "database",
      };
    }

    const accountId = this.config.get<string>("R2_ACCOUNT_ID");
    const accessKeyId = this.config.get<string>("R2_ACCESS_KEY_ID");
    const secretAccessKey = this.config.get<string>("R2_SECRET_ACCESS_KEY");
    const bucket = this.config.get<string>("R2_BUCKET");
    if (accountId && accessKeyId && secretAccessKey && bucket) {
      return {
        driver: new S3StorageDriver({ accountId, accessKeyId, secretAccessKey, bucket, endpoint: this.config.get<string>("R2_ENDPOINT") }),
        name: "s3",
        source: "env",
      };
    }

    return {
      driver: new LocalDiskStorageDriver(join(process.cwd(), ".data", "attachments")),
      name: "local",
      source: "none",
    };
  }

  /**
   * The driver for `location`: the server's storage (null), or an
   * organisation's own bucket (its id, issue #206). A bucket that fails is
   * marked unreachable for its admins; one that's gone is an error.
   */
  private async driverFor(location: StorageLocation): Promise<ObjectStorageDriver> {
    if (!location) return (await this.resolveDriver()).driver;
    const row = await this.prisma.client.organizationStorage.findUnique({ where: { organizationId: location } });
    if (!row) throw new ServiceUnavailableException("This organisation's own storage isn't set up any more");
    return ownStorageDriver(row, this.config.get<string>("SETTINGS_ENCRYPTION_KEY"));
  }

  /** Runs `work` on `location`'s driver; an organisation's bucket that fails is marked unreachable (issue #206). */
  private async on<T>(location: StorageLocation, work: (driver: ObjectStorageDriver) => Promise<T>): Promise<T> {
    const driver = await this.driverFor(location);
    if (!location) return work(driver);
    try {
      return await work(driver);
    } catch (error) {
      if (!(error instanceof NotFoundException)) await this.markUnreachable(location, error);
      throw error;
    }
  }

  /** Records that an organisation's bucket failed, and why, for its admins. */
  async markUnreachable(organizationId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.client.organizationStorage
      .updateMany({ where: { organizationId }, data: { reachable: false, lastError: message.slice(0, 500), checkedAt: new Date() } })
      .catch(() => undefined);
  }

  async put(body: Buffer, contentType: string, location: StorageLocation = null): Promise<StoredObject> {
    const hash = createHash("sha256").update(body).digest("hex");
    await this.on(location, (driver) => driver.putObject(hash, body, contentType));
    return { hash, sizeBytes: body.length };
  }

  /** A file on disk, stored by the hash of its bytes (given: taken as it was written), streamed (issue #351). */
  async putFile(path: string, sha256: string, sizeBytes: number, contentType: string, location: StorageLocation = null): Promise<StoredObject> {
    await this.on(location, (driver) => driver.putFile(sha256, path, sizeBytes, contentType));
    return { hash: sha256, sizeBytes };
  }

  async get(hash: string, location: StorageLocation = null): Promise<Buffer> {
    return this.on(location, (driver) => driver.getObject(hash));
  }

  /** The object, or bytes of it, as a stream (issue #33): for downloads, which never load a file whole. */
  async stream(hash: string, range?: ByteRange, location: StorageLocation = null): Promise<Readable> {
    return this.on(location, (driver) => driver.streamObject(hash, range));
  }

  async size(hash: string, location: StorageLocation = null): Promise<number> {
    return this.on(location, (driver) => driver.objectSize(hash));
  }

  async delete(hash: string, location: StorageLocation = null): Promise<void> {
    return this.on(location, (driver) => driver.deleteObject(hash));
  }

  /**
   * Where a song's new files go (issue #206): its team's organisation's own
   * bucket while it's in use and answering, else the server's storage. A file
   * stored elsewhere is moved by the Worker (OwnStorageService.relocate).
   */
  async locationForSong(songVersionId: string): Promise<StorageLocation> {
    const song = await this.prisma.client.songVersion.findFirst({
      where: { id: songVersionId, deletedAt: undefined },
      select: { ownerTeam: { select: { organization: { select: { ownStorage: { select: { organizationId: true, state: true, reachable: true } } } } } } },
    });
    const own = song?.ownerTeam?.organization?.ownStorage;
    return own && own.state === "ACTIVE" && own.reachable ? own.organizationId : null;
  }

  /** deleteUnreferenced() for files that were somewhere: each where it was (issue #206). */
  async deleteUnreferencedFiles(files: { storageKey: string; originalStorageKey?: string | null; storedInOrganizationId?: string | null }[]): Promise<void> {
    const byLocation = new Map<StorageLocation, string[]>();
    for (const file of files) {
      const location = file.storedInOrganizationId ?? null;
      byLocation.set(location, [...(byLocation.get(location) ?? []), file.storageKey, ...(file.originalStorageKey ? [file.originalStorageKey] : [])]);
    }
    for (const [location, keys] of byLocation) await this.deleteUnreferenced(keys, location);
  }

  /** Tries an organisation's bucket (issue #206): writes, reads back and deletes a small object; throws why it can't. */
  async tryOwnStorage(driver: ObjectStorageDriver): Promise<void> {
    const body = Buffer.from(`Oneverse checks it can use this bucket: ${new Date().toISOString()}`);
    const hash = createHash("sha256").update(body).digest("hex");
    await driver.putObject(hash, body, "text/plain");
    const back = await driver.getObject(hash);
    await driver.deleteObject(hash);
    if (!back.equals(body)) throw new Error("What was written didn't come back the same");
  }

  /** Which driver/source is actually serving uploads - surfaced in the admin Storage panel. */
  /**
   * Deletes whichever of `hashes` nothing references any more. Objects are
   * content-addressed and shared, so an attachment and an avatar (or two
   * attachments) with identical bytes point at the same object.
   */
  async deleteUnreferenced(hashes: string[], location: StorageLocation = null): Promise<void> {
    for (const hash of new Set(hashes)) {
      // In an organisation's bucket (issue #206), only its files are there.
      if (location) {
        const files = await this.prisma.client.attachment.count({ where: { storedInOrganizationId: location, OR: [{ storageKey: hash }, { originalStorageKey: hash }] } });
        if (files === 0) await this.delete(hash, location);
        continue;
      }
      const [attachments, avatars, songImages, artistPictures, teamPictures, songbookPictures, themeFiles, brandFiles, bibleFiles, archives] = await Promise.all([
        // A file, or a lossless original kept beside one (issue #182).
        this.prisma.client.attachment.count({ where: { storedInOrganizationId: null, OR: [{ storageKey: hash }, { originalStorageKey: hash }] } }),
        this.prisma.client.user.count({ where: { avatarStorageKey: hash } }),
        // Song artwork (issue #85): the same album's is often shared by several songs.
        this.prisma.client.songVersion.count({ where: { imageStorageKey: hash, ...BINNED_TOO } }),
        // Artist pictures (issue #86).
        this.prisma.client.artist.count({ where: { imageStorageKey: hash } }),
        // Teams' and songbooks' pictures (issue #161).
        this.prisma.client.team.count({ where: { avatarStorageKey: hash } }),
        this.prisma.client.songbook.count({ where: { avatarStorageKey: hash } }),
        // Screen themes' pictures, videos and fonts (issue #194).
        this.prisma.client.screenThemeAsset.count({ where: { storageKey: hash } }),
        // Brands' logos, backgrounds and fonts (issue #279).
        this.prisma.client.brandAsset.count({ where: { storageKey: hash } }),
        // Bible files waiting to be imported (issue #301).
        this.prisma.client.bible.count({ where: { sourceStorageKey: hash } }),
        // People's, teams' and organisations' archives, and ones waiting to be imported (issue #351).
        this.prisma.client.contentArchive.count({ where: { storageKey: hash } }),
      ]);
      if (attachments === 0 && avatars === 0 && songImages === 0 && artistPictures === 0 && teamPictures === 0 && songbookPictures === 0 && themeFiles === 0 && brandFiles === 0 && bibleFiles === 0 && archives === 0) {
        await this.delete(hash);
      }
    }
  }

  /**
   * Every stored object something references (issue #119): what a backup copies
   * and a restore brings back. The same columns deleteUnreferenced() checks - a
   * new kind of stored file goes in both. Binned songs' artwork too.
   *
   * Not people's archives (issue #351, ContentArchive): each is a copy of
   * files the backup already has, made again weekly, and kept two weeks -
   * a restored server shows them as gone, and the next ones are made.
   * Nor files in an organisation's own bucket (issue #206): the
   * organisation keeps those.
   */
  async storedKeys(): Promise<string[]> {
    const rows = await this.prisma.client.$queryRaw<{ key: string }[]>`
      SELECT key FROM (
        SELECT "storageKey" AS key FROM "Attachment" WHERE "storedInOrganizationId" IS NULL
        UNION SELECT "originalStorageKey" FROM "Attachment" WHERE "storedInOrganizationId" IS NULL
        UNION SELECT "avatarStorageKey" FROM "User"
        UNION SELECT "imageStorageKey" FROM "SongVersion"
        UNION SELECT "imageStorageKey" FROM "Artist"
        UNION SELECT "avatarStorageKey" FROM "Team"
        UNION SELECT "avatarStorageKey" FROM "Songbook"
        UNION SELECT "storageKey" FROM "ScreenThemeAsset"
        UNION SELECT "storageKey" FROM "BrandAsset"
        UNION SELECT "sourceStorageKey" FROM "Bible"
      ) keys WHERE key IS NOT NULL ORDER BY key`;
    return rows.map((row) => row.key);
  }

  /** An object put back under its key, from a backup (issue #119): refused unless the bytes are the ones the key names. */
  async restoreObject(hash: string, body: Buffer): Promise<void> {
    if (createHash("sha256").update(body).digest("hex") !== hash) throw new Error(`The backup's copy of ${hash} doesn't match its key`);
    const { driver } = await this.resolveDriver();
    await driver.putObject(hash, body, "application/octet-stream");
  }

  async describe(): Promise<{ driver: StorageDriverName; source: StorageConfigSource }> {
    const { name, source } = await this.resolveDriver();
    return { driver: name, source };
  }

  async getConfigSummary(): Promise<StorageConfigSummary> {
    const dbSettings = await this.loadDbSettings();
    const hasDb = hasCompleteDbCredentials(dbSettings);
    const envComplete = !!(
      this.config.get<string>("R2_ACCOUNT_ID") &&
      this.config.get<string>("R2_ACCESS_KEY_ID") &&
      this.config.get<string>("R2_SECRET_ACCESS_KEY") &&
      this.config.get<string>("R2_BUCKET")
    );
    const source: StorageConfigSource = hasDb ? "database" : envComplete ? "env" : "none";

    return {
      source,
      driver: source === "none" ? "local" : "s3",
      hasDatabaseConfig: hasDb,
      accountId: dbSettings?.r2AccountId ?? null,
      accessKeyIdMasked: dbSettings?.r2AccessKeyId ? maskSecret(dbSettings.r2AccessKeyId) : null,
      bucket: dbSettings?.r2Bucket ?? null,
      endpoint: dbSettings?.r2Endpoint ?? null,
    };
  }

  /**
   * Partial update, like PATCH: a field left `undefined` keeps its
   * current value (so the admin never has to re-enter the secret key
   * just to change the bucket name); an empty string clears it.
   */
  async saveConfig(input: SaveStorageConfigInput): Promise<void> {
    const encryptedSecret =
      input.secretAccessKey !== undefined
        ? encryptSecret(input.secretAccessKey, this.config.get<string>("SETTINGS_ENCRYPTION_KEY"))
        : undefined;

    await this.prisma.client.storageSettings.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        r2AccountId: input.accountId || null,
        r2AccessKeyId: input.accessKeyId || null,
        r2SecretAccessKeyEnc: encryptedSecret ?? null,
        r2Bucket: input.bucket || null,
        r2Endpoint: input.endpoint || null,
      },
      update: {
        ...(input.accountId !== undefined && { r2AccountId: input.accountId || null }),
        ...(input.accessKeyId !== undefined && { r2AccessKeyId: input.accessKeyId || null }),
        ...(encryptedSecret !== undefined && { r2SecretAccessKeyEnc: encryptedSecret }),
        ...(input.bucket !== undefined && { r2Bucket: input.bucket || null }),
        ...(input.endpoint !== undefined && { r2Endpoint: input.endpoint || null }),
      },
    });
  }

  /**
   * Clears only the R2 fields: the row also holds the default per-user
   * storage limit (see StorageQuotaService), which "revert to env vars"
   * shouldn't touch.
   */
  async clearConfig(): Promise<void> {
    await this.prisma.client.storageSettings.updateMany({
      where: { id: SINGLETON_ID },
      data: { r2AccountId: null, r2AccessKeyId: null, r2SecretAccessKeyEnc: null, r2Bucket: null, r2Endpoint: null },
    });
  }
}
