import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { bibleBookName, formatBibleReference, parseBibleReference, passageHeldKey, usfmBookId, type PassageChapter, type SetItemPassage } from "@oneverse/core";
import { decryptSecret, encryptSecret } from "@oneverse/secret-crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { redis } from "../jobs/redis.js";
import { cacheFreshness, youVersionBibleById, youVersionBibles, youVersionPassage, youVersionPiece, withoutBooks, YouVersionApiError, type Fetcher, type YouVersionBible, type YouVersionBibleBooks, type YouVersionPassagePart, type YouVersionPiece } from "./youversion-api.js";

export interface YouVersionSettings {
  /** Where the App Key comes from: the database's, YOUVERSION_APP_KEY, or none (YouVersion off). */
  source: "database" | "env" | "none";
  hasDatabaseKey: boolean;
  /** Whether passages are kept as long as YouVersion's Cache-Control allows (issue #485): on by default. */
  cache: boolean;
  cacheSource: "database" | "env" | "default";
}

/** Where kept passages are in Redis (issue #485): never in the database, so never in a backup. */
const CACHE_PREFIX = "oneverse:youversion:passage:";

/** YOUVERSION_CACHE: "off" (or false, 0, no) turns keeping off, "on" (true, 1, yes) on; anything else, null - the default. */
function envCache(): boolean | null {
  const raw = process.env.YOUVERSION_CACHE?.trim().toLowerCase();
  if (raw && ["off", "false", "0", "no"].includes(raw)) return false;
  if (raw && ["on", "true", "1", "yes"].includes(raw)) return true;
  return null;
}

/** YouVersion's last answers (issue #485), newest first, for Admin > Bibles: how long it says each may be kept. */
const ANSWERS_KEY = "oneverse:youversion:answers";
const ANSWERS_KEPT = 50;

/** One of YouVersion's answers as Admin > Bibles lists it: what was asked (never the App Key), and its Cache-Control as read. */
export interface YouVersionAnswer {
  at: string;
  /** The path and query asked, like /v1/bibles/3034/passages/JHN.3.16-18. */
  asked: string;
  status: number;
  /** The header as it came; null without one. */
  cacheControl: string | null;
  age: number | null;
  /** Seconds this server may keep it, and a screen: null when the header says nothing (then it isn't kept). */
  shared: number | null;
  private: number | null;
}

/** A piece kept in Redis: its verses, and until when a screen may keep them (ms since the epoch). */
interface KeptPiece {
  parts: YouVersionPiece["parts"];
  privateUntil: number;
}

/**
 * What a passage may be used for beyond being read where it was asked for
 * (issue #301's rights): on screens always - an App Key gets only the versions
 * whose licences its owner accepted, settled with YouVersion rather than in
 * Oneverse (issue #310); never offline or exported - the text is never stored.
 */
export interface YouVersionRights {
  offline: false;
  projection: true;
  export: false;
}

/** How long a version's name and attribution are kept in memory: its details, never its text. */
const VERSION_TTL_MS = 60 * 60 * 1000;

/** YouVersion's pieces of a passage as chapters of verses (a chapter without verse marks as its first verse), each verse's numbers from its id ("JHN.3.16", "JHN.3.16-17"). */
function chaptersOf(book: number, parts: YouVersionPassagePart[]): PassageChapter[] {
  const chapters: PassageChapter[] = [];
  for (const part of parts) {
    const [, chapterText, verseText] = part.id.split(".");
    const chapter = Number.parseInt(chapterText ?? "", 10);
    if (!Number.isInteger(chapter)) continue;
    let into = chapters.find((one) => one.chapter === chapter);
    if (!into) chapters.push((into = { book, chapter, verses: [] }));
    const [from, to] = (verseText ?? "1").split("-").map((one) => Number.parseInt(one, 10));
    const number = Number.isInteger(from) ? from! : 1;
    into.verses.push({ number, ...(Number.isInteger(to) && to! > number && { endNumber: to }), text: part.text });
  }
  return chapters;
}

export interface YouVersionPassage {
  reference: string;
  bible: YouVersionBible;
  parts: YouVersionPassagePart[];
  rights: YouVersionRights;
}

/**
 * YouVersion's Platform API as a Bible provider (issue #304): off without
 * an App Key (the admin's, else YOUVERSION_APP_KEY), resolved fresh on
 * every call. What it answers is kept only as its Cache-Control allows.
 */
@Injectable()
export class YouVersionService {
  private readonly logger = new Logger(YouVersionService.name);
  /** Swapped only by the unit tests. */
  fetcher: Fetcher = (...args) => fetch(...args);

  /** How YouVersion is asked: through `fetcher`, each answer's Cache-Control noted for Admin (issue #485). */
  private readonly ask: Fetcher = async (input, init) => {
    const response = await this.fetcher(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    const fresh = cacheFreshness(response.headers);
    const answer: YouVersionAnswer = {
      at: new Date().toISOString(),
      asked: (/\/v1\/.*$/.exec(url.pathname)?.[0] ?? url.pathname) + url.search,
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      age: response.headers.get("age") === null ? null : Number(response.headers.get("age")),
      shared: fresh.shared,
      private: fresh.private,
    };
    await redis()
      .multi()
      .lpush(ANSWERS_KEY, JSON.stringify(answer))
      .ltrim(ANSWERS_KEY, 0, ANSWERS_KEPT - 1)
      .exec()
      .catch(() => undefined);
    return response;
  };

  /** YouVersion's last answers, newest first (issue #485). */
  async answers(): Promise<YouVersionAnswer[]> {
    const raw = await redis()
      .lrange(ANSWERS_KEY, 0, ANSWERS_KEPT - 1)
      .catch(() => [] as string[]);
    return raw.flatMap((one) => {
      try {
        return [JSON.parse(one) as YouVersionAnswer];
      } catch {
        return [];
      }
    });
  }

  constructor(private readonly prisma: PrismaService) {}

  async settings(): Promise<YouVersionSettings> {
    const row = await this.prisma.client.scriptureSettings.findUnique({ where: { id: "singleton" }, select: { youversionAppKeyEnc: true, youversionCache: true } });
    const env = envCache();
    return {
      source: row?.youversionAppKeyEnc ? "database" : process.env.YOUVERSION_APP_KEY ? "env" : "none",
      hasDatabaseKey: !!row?.youversionAppKeyEnc,
      cache: row?.youversionCache ?? env ?? true,
      cacheSource: row?.youversionCache != null ? "database" : env !== null ? "env" : "default",
    };
  }

  /**
   * Saves what's given, the rest kept: the App Key, encrypted (empty clears
   * it), and whether passages are kept (null: the environment's). Kept
   * passages go when keeping is turned off.
   */
  async saveKey(change: { appKey?: string; cache?: boolean | null }): Promise<YouVersionSettings> {
    const data: { youversionAppKeyEnc?: string | null; youversionCache?: boolean | null } = {};
    if (change.appKey !== undefined) {
      const clean = change.appKey.trim();
      if (clean && !/^[\w.~+/=-]{8,200}$/.test(clean)) throw new BadRequestException("A YouVersion App Key is letters, digits and - _ . ~ + / =");
      data.youversionAppKeyEnc = clean ? encryptSecret(clean, process.env.SETTINGS_ENCRYPTION_KEY) : null;
    }
    if (change.cache !== undefined) data.youversionCache = change.cache;
    await this.prisma.client.scriptureSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });
    const settings = await this.settings();
    if (!settings.cache || data.youversionAppKeyEnc !== undefined) await this.forget();
    return settings;
  }

  /** Back to the environment: YOUVERSION_APP_KEY (without it, YouVersion off) and YOUVERSION_CACHE. */
  async resetKey(): Promise<YouVersionSettings> {
    await this.prisma.client.scriptureSettings.updateMany({ where: { id: "singleton" }, data: { youversionAppKeyEnc: null, youversionCache: null } });
    const settings = await this.settings();
    await this.forget();
    return settings;
  }

  /** Whether passages may be kept now (issue #485), as long as YouVersion's answers allow: the admin's say, else YOUVERSION_CACHE, else yes. */
  async caching(): Promise<boolean> {
    const row = await this.prisma.client.scriptureSettings.findUnique({ where: { id: "singleton" }, select: { youversionCache: true } });
    return row?.youversionCache ?? envCache() ?? true;
  }

  /** Every kept passage removed (issue #485): keeping turned off, or another App Key whose licences may differ. */
  async forget(): Promise<void> {
    try {
      let cursor = "0";
      do {
        const [next, keys] = await redis().scan(cursor, "MATCH", `${CACHE_PREFIX}*`, "COUNT", 500);
        cursor = next;
        if (keys.length) await redis().del(...keys);
      } while (cursor !== "0");
    } catch (err) {
      this.logger.warn(`YouVersion's kept passages couldn't be removed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    const appKey = await this.appKey();
    if (!appKey) return { ok: false, message: "No YouVersion App Key is set: YouVersion isn't asked." };
    try {
      const found = await youVersionBibles("en", appKey, this.ask);
      return { ok: true, message: `YouVersion answered (${found.length} English versions for this App Key).` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** The database's App Key, else YOUVERSION_APP_KEY, else none. */
  async appKey(): Promise<string | null> {
    const row = await this.prisma.client.scriptureSettings.findUnique({ where: { id: "singleton" }, select: { youversionAppKeyEnc: true } });
    if (row?.youversionAppKeyEnc) {
      try {
        return decryptSecret(row.youversionAppKeyEnc, process.env.SETTINGS_ENCRYPTION_KEY);
      } catch (err) {
        this.logger.warn(`The saved YouVersion App Key can't be decrypted (was SETTINGS_ENCRYPTION_KEY changed?): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }
    return process.env.YOUVERSION_APP_KEY || null;
  }

  /** Whether YouVersion can be asked, for clients to show it or not. */
  async available(): Promise<{ youversion: boolean }> {
    return { youversion: !!(await this.appKey()) };
  }

  async bibles(language: string): Promise<YouVersionBible[]> {
    const appKey = await this.requireKey();
    return this.asked(() => youVersionBibles(language, appKey, this.ask));
  }

  /**
   * A passage in a version: the reference read as people write it, the
   * version's attribution with it (its copyright line, else its title and
   * info - a version out of copyright has no line to show), written as the
   * version's language writes it (books named in French for a French one).
   */
  async passage(bibleId: number, text: string, locale?: "en" | "fr"): Promise<YouVersionPassage> {
    const appKey = await this.requireKey();
    const reference = parseBibleReference(text);
    if (!reference) throw new BadRequestException(["reference must be a passage of one book, like John 3:16-18"]);
    if (reference.ranges.length === 0) throw new BadRequestException(["reference must be a chapter or verses, not a whole book"]);
    const bible = withoutBooks(await this.asked(() => this.version(bibleId, appKey)));
    const { parts } = await this.asked(async () => youVersionPassage(bibleId, reference, appKey, this.ask, this.pieceAsker(bibleId, appKey, await this.caching())));
    return { reference: formatBibleReference(reference, { locale: locale ?? (bible.languageTag.startsWith("fr") ? "fr" : "en") }), bible, parts, rights: { offline: false, projection: true, export: false } };
  }

  /**
   * A reference to keep in a set (issues #310, #485), as the version's
   * language writes it: checked against the version's books, without asking
   * for its text - it was read just before, and is read again when shown.
   */
  async reference(bibleId: number, text: string): Promise<string> {
    const appKey = await this.requireKey();
    const reference = parseBibleReference(text);
    if (!reference) throw new BadRequestException(["reference must be a passage of one book, like John 3:16-18"]);
    if (reference.ranges.length === 0) throw new BadRequestException(["reference must be a chapter or verses, not a whole book"]);
    const bible = await this.asked(() => this.version(bibleId, appKey));
    const book = usfmBookId(reference.book);
    if (bible.books && book && !bible.books.includes(book)) throw new NotFoundException(`YouVersion has no such passage or version: ${bible.abbreviation} has no ${bibleBookName(reference.book, "en")}`);
    return formatBibleReference(reference, { locale: bible.languageTag.startsWith("fr") ? "fr" : "en" });
  }

  /**
   * A set's passage from a version (issue #310) as `use` may have it: its
   * verses asked of YouVersion each time someone reads it or a screen shows
   * it - kept only as long as YouVersion's Cache-Control allows (issue
   * #485), on this server and on a screen (`keepSeconds`), unless an admin
   * turned keeping off. `held`: what a screen already shows, not
   * asked again (its verses left out, `held` said). YouVersion off or not
   * answering leaves the reference, without verses.
   */
  async itemPassage(bibleId: number, text: string, use: "read" | "list" | "offline" | "screen", held?: ReadonlySet<string>): Promise<SetItemPassage> {
    const reference = parseBibleReference(text);
    const passage: SetItemPassage = { bibleId: "", youversionId: bibleId, reference: text, bookName: reference ? bibleBookName(reference.book, "en") : "", bible: null, chapters: [], projection: true, link: null };
    const appKey = await this.appKey();
    if (!appKey) return passage;
    try {
      const bible = await this.version(bibleId, appKey);
      const named: SetItemPassage = { ...passage, bookName: text.replace(/\s*\d[\d:,.\s;-]*$/, "") || passage.bookName, bible: { name: bible.title, abbreviation: bible.abbreviation, copyright: bible.attribution }, link: bible.link };
      if (!reference || reference.ranges.length === 0 || !(use === "read" || use === "screen")) return named;
      if (use === "screen" && held?.has(passageHeldKey({ youversionId: bibleId, reference: text })!)) return { ...named, held: true };
      const caching = await this.caching();
      const found = await youVersionPassage(bibleId, reference, appKey, this.ask, this.pieceAsker(bibleId, appKey, caching));
      // On a screen, kept on the device as long as YouVersion allows a private cache to (issue #485).
      const kept = use === "screen" ? { keepSeconds: caching ? found.keepSeconds : 0 } : {};
      return { ...named, ...kept, chapters: chaptersOf(reference.book, found.parts) };
    } catch (err) {
      this.logger.warn(`YouVersion's passage for a set failed: ${err instanceof Error ? err.message : String(err)}`);
      return passage;
    }
  }

  /**
   * What asks YouVersion for one passage id: the same request at the same
   * moment (screens loading together) asked once, and answers kept in Redis
   * as long as their Cache-Control lets a shared cache keep them (issue #485)
   * - never when an admin turned keeping off. A kept answer says how long a
   * screen may still keep it: what its header allowed, less the time since.
   */
  private readonly asking = new Map<string, Promise<YouVersionPiece>>();
  private pieceAsker(bibleId: number, appKey: string, caching: boolean): (id: string) => Promise<YouVersionPiece> {
    return (id) => {
      const key = `${CACHE_PREFIX}${bibleId}:${id}`;
      const pending = this.asking.get(key);
      if (pending) return pending;
      const ask = (async (): Promise<YouVersionPiece> => {
        if (caching) {
          const [kept, ttl] = await Promise.all([redis().get(key), redis().pttl(key)]).catch(() => [null, -2] as const);
          if (kept && ttl > 0) {
            try {
              const piece = JSON.parse(kept) as KeptPiece;
              return { parts: piece.parts, shared: Math.floor(ttl / 1000), private: Math.max(0, Math.floor((piece.privateUntil - Date.now()) / 1000)) };
            } catch {
              // Not readable: asked again.
            }
          }
        }
        const piece = await youVersionPiece(bibleId, id, appKey, this.ask);
        if (caching && piece.shared > 0) {
          const kept: KeptPiece = { parts: piece.parts, privateUntil: Date.now() + piece.private * 1000 };
          await redis()
            .set(key, JSON.stringify(kept), "EX", piece.shared)
            .catch(() => undefined);
        }
        return piece;
      })().finally(() => this.asking.delete(key));
      this.asking.set(key, ask);
      return ask;
    };
  }

  /** A version's details, kept an hour in memory: a set lists its passages often. */
  private readonly versions = new Map<number, { bible: YouVersionBibleBooks; until: number }>();
  private async version(bibleId: number, appKey: string): Promise<YouVersionBibleBooks> {
    const kept = this.versions.get(bibleId);
    if (kept && Date.now() < kept.until) return kept.bible;
    const { bible, fresh } = await youVersionBibleById(bibleId, appKey, this.ask);
    // As long as its Cache-Control allows (issue #485); an hour when it says nothing.
    this.versions.set(bibleId, { bible, until: Date.now() + (fresh.shared === null ? VERSION_TTL_MS : fresh.shared * 1000) });
    return bible;
  }

  private async requireKey(): Promise<string> {
    const appKey = await this.appKey();
    if (!appKey) throw new ServiceUnavailableException("YouVersion isn't set up: an admin adds its App Key in Admin > Bibles");
    return appKey;
  }

  /** YouVersion's answer, its errors as the API's own. */
  private async asked<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof YouVersionApiError)) {
        this.logger.warn(`YouVersion failed: ${err instanceof Error ? err.message : String(err)}`);
        throw new ServiceUnavailableException("YouVersion isn't answering - try again in a moment");
      }
      if (err.status === 400) throw new BadRequestException([err.message]);
      if (err.status === 404) throw new NotFoundException(err.message);
      this.logger.warn(`YouVersion answered ${err.status}: ${err.message}`);
      throw new ServiceUnavailableException(err.message);
    }
  }
}
