import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { decryptStream, encryptStream } from "./backup-crypto.js";
import { DirBackupTarget, readAll } from "./backup-target.js";
import { libpqUrl } from "./pg-tools.js";
import { dumpKey, dumpsToKeep, dumpTime, isoWeek } from "./rotation.js";

const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("dumpsToKeep", () => {
  const at = (iso: string) => ({ key: dumpKey(new Date(iso)), at: new Date(iso) });

  it("keeps the newest of each of the last days, weeks and months", () => {
    // A dump every day at 03:00 for 400 days, and a second one on the newest day.
    const dumps = Array.from({ length: 400 }, (_, i) => at(new Date(Date.UTC(2026, 9, 31, 3) - i * 86_400_000).toISOString()));
    dumps.push(at("2026-10-31T15:00:00Z"));
    const kept = dumpsToKeep(dumps, { daily: 7, weekly: 4, monthly: 12 });
    const days = [...kept].map((key) => dumpTime(key)!.toISOString()).sort();
    // The newest (15:00), six more days, the newest of four weeks and of twelve months (some the same dumps).
    expect(kept.has(dumpKey(new Date("2026-10-31T15:00:00Z")))).toBe(true);
    expect(kept.has(dumpKey(new Date("2026-10-31T03:00:00Z")))).toBe(false);
    expect(days.filter((day) => day >= "2026-10-25")).toHaveLength(7);
    expect(days[0]! >= "2025-11-01").toBe(true);
    expect(new Set(days.map((day) => day.slice(0, 7))).size).toBe(12);
    expect(kept.size).toBeLessThanOrEqual(7 + 4 + 12);
    expect(kept.size).toBeGreaterThanOrEqual(12 + 6);
  });

  it("keeps every dump while there are fewer than asked, and the newest with nothing asked", () => {
    const dumps = [at("2026-10-30T03:00:00Z"), at("2026-10-31T03:00:00Z")];
    expect(dumpsToKeep(dumps, { daily: 7, weekly: 4, monthly: 12 }).size).toBe(2);
    expect([...dumpsToKeep(dumps, { daily: 1, weekly: 0, monthly: 0 })]).toEqual([dumps[1]!.key]);
  });

  it("names dumps by their time, and reads it back", () => {
    const when = new Date("2026-10-31T03:04:05.678Z");
    expect(dumpKey(when)).toBe("db/2026-10-31T03-04-05Z.dump.enc");
    expect(dumpTime(dumpKey(when))?.toISOString()).toBe("2026-10-31T03:04:05.000Z");
    expect(dumpTime("db/notes.txt")).toBeNull();
  });

  it("counts ISO weeks", () => {
    expect(isoWeek(new Date("2026-10-31T12:00:00Z"))).toBe("2026-W44");
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(isoWeek(new Date("2024-12-30T12:00:00Z"))).toBe("2025-W01");
  });
});

describe("dump encryption", () => {
  const bytes = Buffer.from(Array.from({ length: 100_003 }, (_, i) => (i * 31) % 256));

  it("round-trips, and refuses another key", async () => {
    const encrypted = await readAll(Readable.from([bytes]).pipe(encryptStream("key-one")));
    expect(encrypted!.subarray(0, 8).toString("latin1")).toBe("Salted__");
    expect(await readAll(Readable.from([encrypted!]).pipe(decryptStream("key-one")))).toEqual(bytes);
    await expect(readAll(Readable.from([encrypted!]).pipe(decryptStream("key-two")))).rejects.toThrow(/SETTINGS_ENCRYPTION_KEY/);
  });

  it.skipIf(!hasOpenssl)("is what openssl enc -aes-256-cbc -pbkdf2 -iter 100000 opens, both ways", async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-crypto-"));
    try {
      await pipeline(Readable.from([bytes]), encryptStream("a passphrase"), createWriteStream(join(dir, "ours.enc")));
      const opened = execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "100000", "-md", "sha256", "-in", join(dir, "ours.enc"), "-pass", "pass:a passphrase"]);
      expect(Buffer.compare(opened, bytes)).toBe(0);
      await writeFile(join(dir, "plain"), bytes);
      execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "100000", "-md", "sha256", "-in", join(dir, "plain"), "-out", join(dir, "theirs.enc"), "-pass", "pass:a passphrase"]);
      expect(await readAll(createReadStream(join(dir, "theirs.enc")).pipe(decryptStream("a passphrase")))).toEqual(await readFile(join(dir, "plain")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("libpqUrl", () => {
  it("drops Prisma's own parameters, keeps libpq's", () => {
    expect(libpqUrl("postgresql://u:p@db:5432/oneverse?schema=public&sslmode=require&connection_limit=5")).toBe("postgresql://u:p@db:5432/oneverse?sslmode=require");
  });
});

describe("DirBackupTarget", () => {
  it("writes, lists, reads and deletes under the folder, never outside it", async () => {
    const root = await mkdtemp(join(tmpdir(), "backup-dir-"));
    try {
      const target = new DirBackupTarget(root);
      await target.put("files/abc", Readable.from([Buffer.from("hello")]), 5);
      await target.put("db/x.dump.enc", Readable.from([Buffer.from("dump")]), 4);
      expect((await target.list("files/")).map((item) => item.key)).toEqual(["files/abc"]);
      expect((await readAll(await target.get("files/abc")))?.toString()).toBe("hello");
      expect(await target.get("files/missing")).toBeNull();
      await target.delete("files/abc");
      expect(await target.list("files/")).toEqual([]);
      await expect(target.put("../outside", Readable.from([Buffer.from("no")]), 2)).rejects.toThrow(/outside/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
