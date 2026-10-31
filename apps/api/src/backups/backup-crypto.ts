import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

/**
 * The database dumps are encrypted (issue #119) the way
 * `openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -md sha256` does it, so one
 * can be opened without Oneverse's code (Deploy.md, "Restoring"): "Salted__",
 * an 8-byte salt, then AES-256-CBC with the key and IV drawn from the
 * passphrase by PBKDF2-SHA256. The passphrase is the server's
 * SETTINGS_ENCRYPTION_KEY, which a restore needs anyway for the secrets saved
 * in Admin: one thing to keep in the password manager, not two.
 */
export const DUMP_ITERATIONS = 100_000;
const MAGIC = Buffer.from("Salted__", "latin1");

function keyAndIv(passphrase: string, salt: Buffer): { key: Buffer; iv: Buffer } {
  const derived = pbkdf2Sync(Buffer.from(passphrase, "utf8"), salt, DUMP_ITERATIONS, 48, "sha256");
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

export function dumpPassphrase(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.SETTINGS_ENCRYPTION_KEY;
  if (!key) throw new Error("SETTINGS_ENCRYPTION_KEY is not set: the database dump can't be encrypted or opened without it");
  return key;
}

/** Bytes in, the encrypted file out. */
export function encryptStream(passphrase: string): Transform {
  const salt = randomBytes(8);
  const { key, iv } = keyAndIv(passphrase, salt);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, done: TransformCallback) {
      if (!started) {
        started = true;
        this.push(Buffer.concat([MAGIC, salt]));
      }
      done(null, cipher.update(chunk));
    },
    flush(done: TransformCallback) {
      if (!started) this.push(Buffer.concat([MAGIC, salt]));
      done(null, cipher.final());
    },
  });
}

/** The encrypted file in, the bytes out; fails on a wrong passphrase (bad padding) or a file that isn't one. */
export function decryptStream(passphrase: string): Transform {
  let header = Buffer.alloc(0);
  let decipher: ReturnType<typeof createDecipheriv> | null = null;
  return new Transform({
    transform(chunk: Buffer, _encoding, done: TransformCallback) {
      if (decipher) return done(null, decipher.update(chunk));
      header = Buffer.concat([header, chunk]);
      if (header.length < 16) return done();
      if (!header.subarray(0, 8).equals(MAGIC)) return done(new Error("Not an encrypted dump (no \"Salted__\" header)"));
      const { key, iv } = keyAndIv(passphrase, header.subarray(8, 16));
      decipher = createDecipheriv("aes-256-cbc", key, iv);
      done(null, decipher.update(header.subarray(16)));
    },
    flush(done: TransformCallback) {
      if (!decipher) return done(new Error("Not an encrypted dump (too short)"));
      try {
        done(null, decipher.final());
      } catch {
        done(new Error("The dump can't be decrypted: SETTINGS_ENCRYPTION_KEY isn't the one it was made with"));
      }
    },
  });
}
