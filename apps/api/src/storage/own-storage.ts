import type { OrganizationStorage } from "@oneverse/db";
import { decryptSecret } from "@oneverse/secret-crypto";
import { join } from "node:path";
import { LocalDiskStorageDriver } from "./local-disk-storage.driver.js";
import type { ObjectStorageDriver } from "./object-storage-driver.js";
import { PROVIDER_TIMEOUT_MS } from "../metadata/provider-timeout.js";
import { S3StorageDriver } from "./s3-storage.driver.js";

/**
 * An organisation's own bucket (issue #206). Only known providers: the
 * address is made from the provider and an account ID or a region checked
 * here, never typed in, so the server only ever calls those providers' hosts.
 */
export const OWN_STORAGE_PROVIDERS = ["R2", "S3", "B2", "WASABI"] as const;
export type OwnStorageProviderName = (typeof OWN_STORAGE_PROVIDERS)[number];

const R2_ACCOUNT = /^[a-f0-9]{32}$/;
const REGIONS: Record<Exclude<OwnStorageProviderName, "R2">, RegExp> = {
  // us-east-1, eu-west-3, ap-southeast-2…
  S3: /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/,
  // us-west-004, eu-central-003…
  B2: /^[a-z]{2}-[a-z]+-\d{3}$/,
  // us-east-1, eu-central-2…
  WASABI: /^[a-z]{2}-[a-z]+-\d{1,2}$/,
};
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/** What's wrong with these settings, or null. */
export function ownStorageProblem(provider: OwnStorageProviderName, accountId: string | null, region: string | null, bucket: string): string | null {
  if (!BUCKET.test(bucket) || bucket.includes("..")) return "bucket must be a bucket's name: 3 to 63 lowercase letters, digits, dots and dashes";
  if (provider === "R2") return accountId && R2_ACCOUNT.test(accountId) ? null : "accountId must be the Cloudflare account's ID: 32 letters and digits";
  return region && REGIONS[provider].test(region) ? null : `region must be one of ${provider}'s regions, like ${provider === "B2" ? "us-west-004" : "eu-central-1"}`;
}

/** The provider's address for these settings (checked by ownStorageProblem first). */
export function ownStorageEndpoint(provider: OwnStorageProviderName, accountId: string | null, region: string | null): { endpoint: string; region: string } {
  if (provider === "R2") return { endpoint: `https://${accountId}.r2.cloudflarestorage.com`, region: "auto" };
  if (provider === "S3") return { endpoint: `https://s3.${region}.amazonaws.com`, region: region! };
  if (provider === "B2") return { endpoint: `https://s3.${region}.backblazeb2.com`, region: region! };
  return { endpoint: `https://s3.${region}.wasabisys.com`, region: region! };
}

/**
 * The driver for an organisation's bucket. OWN_STORAGE_LOCAL_DIR (tests and
 * local development only) keeps each "bucket" as a folder there instead, so
 * the e2e suites need no provider.
 */
export function ownStorageDriver(row: Pick<OrganizationStorage, "provider" | "accountId" | "region" | "bucket" | "accessKeyId" | "secretAccessKeyEnc">, settingsKey: string | undefined): ObjectStorageDriver {
  const local = process.env.OWN_STORAGE_LOCAL_DIR;
  if (local) return new LocalDiskStorageDriver(join(local, row.bucket));
  const { endpoint, region } = ownStorageEndpoint(row.provider, row.accountId, row.region);
  return new S3StorageDriver({ accountId: row.accountId ?? "", accessKeyId: row.accessKeyId, secretAccessKey: decryptSecret(row.secretAccessKeyEnc, settingsKey), bucket: row.bucket, endpoint, region, timeouts: { connectMs: PROVIDER_TIMEOUT_MS, idleMs: 60_000 } });
}
