import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { formatBibleReference, parseBibleReference } from "@oneverse/core";
import { decryptSecret, encryptSecret } from "@oneverse/secret-crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { youVersionBibleById, youVersionBibles, youVersionPassage, YouVersionApiError, type Fetcher, type YouVersionBible, type YouVersionPassagePart } from "./youversion-api.js";

export interface YouVersionSettings {
  /** Where the App Key comes from: the database's, YOUVERSION_APP_KEY, or none (YouVersion off). */
  source: "database" | "env" | "none";
  hasDatabaseKey: boolean;
}

/**
 * What a passage may be used for beyond being read where it was asked for
 * (issue #301's rights): nothing yet - each version's licence decides, and
 * none is read (issue #304). The text is never stored.
 */
export interface YouVersionRights {
  offline: false;
  projection: false;
  export: false;
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
 * every call. Nothing it answers is kept.
 */
@Injectable()
export class YouVersionService {
  private readonly logger = new Logger(YouVersionService.name);
  /** Swapped only by the unit tests. */
  fetcher: Fetcher = (...args) => fetch(...args);

  constructor(private readonly prisma: PrismaService) {}

  async settings(): Promise<YouVersionSettings> {
    const row = await this.prisma.client.scriptureSettings.findUnique({ where: { id: "singleton" }, select: { youversionAppKeyEnc: true } });
    return {
      source: row?.youversionAppKeyEnc ? "database" : process.env.YOUVERSION_APP_KEY ? "env" : "none",
      hasDatabaseKey: !!row?.youversionAppKeyEnc,
    };
  }

  /** Saves the App Key, encrypted; empty clears it. */
  async saveKey(appKey: string): Promise<YouVersionSettings> {
    const clean = appKey.trim();
    if (clean && !/^[\w.~+/=-]{8,200}$/.test(clean)) throw new BadRequestException("A YouVersion App Key is letters, digits and - _ . ~ + / =");
    const data = { youversionAppKeyEnc: clean ? encryptSecret(clean, process.env.SETTINGS_ENCRYPTION_KEY) : null };
    await this.prisma.client.scriptureSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });
    return this.settings();
  }

  /** Back to YOUVERSION_APP_KEY (without it, YouVersion off). */
  async resetKey(): Promise<YouVersionSettings> {
    await this.prisma.client.scriptureSettings.updateMany({ where: { id: "singleton" }, data: { youversionAppKeyEnc: null } });
    return this.settings();
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    const appKey = await this.appKey();
    if (!appKey) return { ok: false, message: "No YouVersion App Key is set: YouVersion isn't asked." };
    try {
      const found = await youVersionBibles("en", appKey, this.fetcher);
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
    return this.asked(() => youVersionBibles(language, appKey, this.fetcher));
  }

  /**
   * A passage in a version: the reference read as people write it, the
   * version's attribution with it (its copyright line, else its title and
   * info - a version out of copyright has no line to show).
   */
  async passage(bibleId: number, text: string, locale: "en" | "fr" = "en"): Promise<YouVersionPassage> {
    const appKey = await this.requireKey();
    const reference = parseBibleReference(text);
    if (!reference) throw new BadRequestException(["reference must be a passage of one book, like John 3:16-18"]);
    if (reference.ranges.length === 0) throw new BadRequestException(["reference must be a chapter or verses, not a whole book"]);
    const bible = await this.asked(() => youVersionBibleById(bibleId, appKey, this.fetcher));
    const parts = await this.asked(() => youVersionPassage(bibleId, reference, appKey, this.fetcher));
    return { reference: formatBibleReference(reference, { locale }), bible, parts, rights: { offline: false, projection: false, export: false } };
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
