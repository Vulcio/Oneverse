import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { BIO_LANGUAGES, foldForSearch } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import { AccessPolicyService } from "../access/access-policy.service.js";
import { artistImageUrl } from "../artwork/song-image-url.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { ImageService, type ProcessedImage } from "../images/image.service.js";
import { MetadataService } from "../metadata/metadata.service.js";
import { MusicBrainzService } from "../musicbrainz/musicbrainz.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { fetchProviderImage } from "../images/provider-image.js";
import { wikipediaSummary, wikipediaTitles } from "./artist-sources.js";

/** The languages bios are kept in: the app's. */

/** How an artist is matched: its name without case, accents or extra spaces. */
export const artistKey = (name: string) => foldForSearch(name).replace(/\s+/g, " ").trim();

export interface ArtistDetail {
  id: string | null;
  name: string;
  /** Songs by them the viewer can see. */
  songCount: number;
  imageUrl: string | null;
  /** Where the picture came from: a provider ("deezer", "spotify", "apple_music"), "upload", or null. */
  imageSource: string | null;
  imageSourceUrl: string | null;
  /** One per language (en, fr): the reader picks theirs. */
  bios: { text: string; language: string; sourceUrl: string | null; custom: boolean }[];
  /** Whether the providers have been asked yet. */
  lookedUp: boolean;
  lookupsEnabled: boolean;
  /** Global admins edit artists: they're the same for everyone. */
  canEdit: boolean;
}

export interface EffectiveArtistSettings {
  enabled: boolean;
  source: "database" | "env" | "default";
}

/**
 * Artists (issue #86): the names songs credit as their artist, each with a
 * picture (Deezer's, or uploaded) and a short bio (Wikipedia's summary,
 * found through MusicBrainz and Wikidata, or written here). An artist is
 * shown to whoever can see a song by them.
 */
@Injectable()
export class ArtistsService {
  private readonly logger = new Logger(ArtistsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly musicBrainz: MusicBrainzService,
    private readonly storage: StorageService,
    private readonly images: ImageService,
    private readonly metadata: MetadataService,
  ) {}

  /** The database's setting, else ARTIST_LOOKUPS ("off" turns them off), else on. */
  async settings(): Promise<EffectiveArtistSettings> {
    const row = await this.prisma.client.metadataSettings.findUnique({ where: { id: "singleton" }, select: { artistsEnabled: true } });
    if (row?.artistsEnabled != null) return { enabled: row.artistsEnabled, source: "database" };
    const env = process.env.ARTIST_LOOKUPS?.trim().toLowerCase();
    if (env) return { enabled: !["off", "false", "0", "no"].includes(env), source: "env" };
    return { enabled: true, source: "default" };
  }

  async saveSettings(enabled: boolean): Promise<EffectiveArtistSettings> {
    await this.prisma.client.metadataSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", artistsEnabled: enabled },
      update: { artistsEnabled: enabled },
    });
    return this.settings();
  }

  async resetSettings(): Promise<EffectiveArtistSettings> {
    await this.prisma.client.metadataSettings.updateMany({ where: { id: "singleton" }, data: { artistsEnabled: null } });
    return this.settings();
  }

  /** The artists' pictures by key, for the list of artists. */
  async picturesByKey(keys: string[]): Promise<Map<string, string>> {
    const artists = await this.prisma.client.artist.findMany({
      where: { key: { in: keys }, imageStorageKey: { not: null } },
      select: { id: true, key: true, imageStorageKey: true },
    });
    const now = Date.now();
    return new Map(artists.map((artist) => [artist.key, artistImageUrl(artist.id, artist.imageStorageKey, now)!]));
  }

  /** An artist, as the viewer sees them; not found when they can see no song by them. */
  async detail(user: AuthenticatedUser, name: string): Promise<ArtistDetail> {
    const { songCount, creditedAs } = await this.visibleSongs(user, name);
    const artist = await this.prisma.client.artist.findUnique({ where: { key: artistKey(name) }, include: { bios: { orderBy: { language: "asc" } } } });
    return {
      id: artist?.id ?? null,
      name: artist?.name ?? creditedAs,
      songCount,
      imageUrl: artist ? artistImageUrl(artist.id, artist.imageStorageKey) : null,
      imageSource: artist?.imageStorageKey ? artist.imageSource : null,
      imageSourceUrl: artist?.imageStorageKey ? artist.imageSourceUrl : null,
      bios: (artist?.bios ?? []).map((bio) => ({ text: bio.text, language: bio.language, sourceUrl: bio.sourceUrl, custom: bio.custom })),
      lookedUp: !!artist?.lookedUpAt,
      lookupsEnabled: (await this.settings()).enabled,
      canEdit: user.isGlobalAdmin,
    };
  }

  /**
   * Asks the providers about an artist the viewer can see: a picture unless
   * it has one (or one uploaded, unless `force`), bios in the languages it
   * has none written here.
   */
  async lookUp(user: AuthenticatedUser, name: string, force = false): Promise<ArtistDetail> {
    const { creditedAs } = await this.visibleSongs(user, name);
    if (!(await this.settings()).enabled) throw new BadRequestException("Artist pictures and bios are turned off");
    const artist = await this.ensure(creditedAs);
    await this.lookUpArtist(artist.id, force);
    return this.detail(user, name);
  }

  /**
   * Looks up a newly credited artist not asked about yet - a job on the
   * lookups queue (issue #92), one at a time: MusicBrainz takes one request
   * a second, shared with Auto detect.
   */
  async lookUpNamed(name: string): Promise<{ picture: boolean; bios: number; failed: boolean } | null> {
    const key = artistKey(name);
    if (!key || !(await this.settings()).enabled) return null;
    const existing = await this.prisma.client.artist.findUnique({ where: { key }, select: { lookedUpAt: true } });
    if (existing?.lookedUpAt) return null;
    const artist = await this.ensure(name.trim());
    return this.lookUpArtist(artist.id, false);
  }

  /** Looks up artists nobody has asked about yet, the most recently credited first, a few at a time (the providers limit how fast they're asked). */
  async backfill(limit = 25): Promise<{ tried: number; found: number; failed: number }> {
    if (!(await this.settings()).enabled) throw new NotFoundException("Artist pictures and bios are turned off");
    // The most recently credited first.
    const credited = await this.prisma.client.versionContributor.findMany({
      where: { roles: { has: "PERFORMER" }, source: { not: null } },
      select: { source: true },
      orderBy: { createdAt: "desc" },
    });
    const byKey = new Map<string, string>();
    for (const { source } of credited) {
      const key = artistKey(source!);
      if (key && !byKey.has(key)) byKey.set(key, source!.trim());
    }
    const asked = new Set(
      (await this.prisma.client.artist.findMany({ where: { key: { in: [...byKey.keys()] }, lookedUpAt: { not: null } }, select: { key: true } })).map((a) => a.key),
    );
    const todo = [...byKey].filter(([key]) => !asked.has(key)).slice(0, limit);
    let found = 0;
    let failed = 0;
    for (const [, name] of todo) {
      const artist = await this.ensure(name);
      const result = await this.lookUpArtist(artist.id, false);
      if (result.picture || result.bios > 0) found++;
      if (result.failed) failed++;
    }
    return { tried: todo.length, found, failed };
  }

  /** A picture of the editor's own (already cropped square by the web app; made a WebP here like the rest). */
  async uploadPicture(user: AuthenticatedUser, name: string, body: Buffer): Promise<void> {
    const { creditedAs } = await this.visibleSongs(user, name);
    const artist = await this.ensure(creditedAs);
    await this.storePicture(artist.id, body, "upload", null);
  }

  async removePicture(user: AuthenticatedUser, name: string): Promise<void> {
    await this.visibleSongs(user, name);
    const artist = await this.prisma.client.artist.findUnique({ where: { key: artistKey(name) } });
    if (!artist?.imageStorageKey) return;
    // "none": a new lookup doesn't bring Deezer's back unless asked to.
    await this.prisma.client.artist.update({ where: { id: artist.id }, data: { imageStorageKey: null, imageSource: "none", imageSourceUrl: null } });
    await this.storage.deleteUnreferenced([artist.imageStorageKey]);
  }

  /** A bio written here, in one language; an empty one removes it (a new lookup then brings Wikipedia's). */
  async saveBio(user: AuthenticatedUser, name: string, language: string, text: string): Promise<void> {
    if (!(BIO_LANGUAGES as readonly string[]).includes(language)) throw new BadRequestException(`A bio is in ${BIO_LANGUAGES.join(" or ")}`);
    const { creditedAs } = await this.visibleSongs(user, name);
    const artist = await this.ensure(creditedAs);
    const clean = text.trim();
    if (!clean) {
      await this.prisma.client.artistBio.deleteMany({ where: { artistId: artist.id, language } });
      return;
    }
    await this.prisma.client.artistBio.upsert({
      where: { artistId_language: { artistId: artist.id, language } },
      create: { artistId: artist.id, language, text: clean, sourceUrl: null, custom: true },
      update: { text: clean, sourceUrl: null, custom: true },
    });
  }

  /** An artist's picture, resized: only with its current key (the caller checks the signature). */
  async image(artistId: string, storageKey: string, width: number): Promise<ProcessedImage> {
    const artist = await this.prisma.client.artist.findUnique({ where: { id: artistId }, select: { imageStorageKey: true } });
    if (!artist || artist.imageStorageKey !== storageKey) throw new NotFoundException("No such picture");
    return this.images.resize(storageKey, () => this.storage.get(storageKey), width);
  }

  /** How many songs by `name` the viewer can see, and the name as one of them credits it; not found when none. */
  private async visibleSongs(user: AuthenticatedUser, name: string): Promise<{ songCount: number; creditedAs: string }> {
    const clean = name.trim();
    if (!clean) throw new NotFoundException("No such artist");
    const [row] = await this.prisma.client.$queryRaw<{ folded: string }[]>`SELECT unaccent(${clean}) AS folded`;
    const credit: Prisma.VersionContributorWhereInput = { roles: { has: "PERFORMER" }, sourceSearch: { equals: row?.folded ?? clean, mode: "insensitive" } };
    const where: Prisma.SongVersionWhereInput = { AND: [await this.access.songsVisibleTo(user), { contributors: { some: credit } }] };
    const [songCount, first] = await Promise.all([
      this.prisma.client.songVersion.count({ where }),
      this.prisma.client.versionContributor.findFirst({ where: { ...credit, songVersion: where }, select: { source: true } }),
    ]);
    if (songCount === 0 || !first?.source) throw new NotFoundException("No such artist");
    return { songCount, creditedAs: first.source.trim() };
  }

  private async ensure(name: string) {
    const key = artistKey(name);
    return this.prisma.client.artist.upsert({ where: { key }, create: { key, name }, update: {} });
  }

  /** Asks Deezer for the picture and Wikipedia for the bios; one failing doesn't stop the other. */
  /**
   * Asks the providers about an artist. When one fails (issue #93), what
   * was found is kept but the artist isn't marked looked up - nor as
   * having no picture - so the next lookup tries again.
   */
  private async lookUpArtist(artistId: string, force: boolean): Promise<{ picture: boolean; bios: number; failed: boolean }> {
    const artist = await this.prisma.client.artist.findUniqueOrThrow({ where: { id: artistId }, include: { bios: true } });
    let picture = false;
    let bios = 0;
    let pictureFailed = false;
    let bioFailed = false;
    const keepPicture = !!artist.imageStorageKey && (!force || artist.imageSource === "upload");
    if (!keepPicture && (force || artist.imageSource !== "none")) {
      try {
        // From the first provider allowed to give artist pictures that has one (issue #89).
        const { found, failed } = await this.metadata.artistPicture(artist.name);
        if (found) {
          picture = await this.downloadPicture(artist.id, found.url, found.pageUrl, found.provider);
          pictureFailed = !picture;
        } else pictureFailed = failed.length > 0;
      } catch (err) {
        pictureFailed = true;
        this.logger.warn(`No picture for ${artist.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    let { musicbrainzId, wikidataId } = artist;
    // Bios are Wikipedia's, found through MusicBrainz: only when it's asked for them (issue #89).
    const bioLookups = (await this.metadata.providersFor("artistBios")).includes("musicbrainz");
    try {
      if (!bioLookups) throw new Skip();
      if (!musicbrainzId || force) {
        const found = await this.musicBrainz.findArtist(artist.name);
        musicbrainzId = found?.mbid ?? null;
        wikidataId = found?.wikidataId ?? null;
      }
      const languages = BIO_LANGUAGES.filter((language) => !artist.bios.some((bio) => bio.language === language && bio.custom));
      if (wikidataId && languages.length > 0) {
        const titles = await wikipediaTitles(wikidataId, languages);
        for (const language of languages) {
          const title = titles[language];
          const bio = title ? await wikipediaSummary(language, title) : null;
          if (!bio) continue;
          await this.prisma.client.artistBio.upsert({
            where: { artistId_language: { artistId: artist.id, language } },
            create: { artistId: artist.id, language, text: bio.text, sourceUrl: bio.sourceUrl },
            update: { text: bio.text, sourceUrl: bio.sourceUrl, custom: false },
          });
          bios++;
        }
      }
    } catch (err) {
      if (!(err instanceof Skip)) {
        bioFailed = true;
        this.logger.warn(`No bio for ${artist.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const failed = pictureFailed || bioFailed;
    await this.prisma.client.artist.update({
      where: { id: artist.id },
      data: {
        musicbrainzId,
        wikidataId,
        // Not looked up when a provider failed: tried again next time.
        lookedUpAt: failed ? null : new Date(),
        ...(!picture && !pictureFailed && !keepPicture && !artist.imageStorageKey && { imageSource: "none" }),
      },
    });
    return { picture, bios, failed };
  }

  private async downloadPicture(artistId: string, url: string, pageUrl: string, provider: string): Promise<boolean> {
    let body: Buffer;
    try {
      body = await fetchProviderImage(url);
    } catch {
      return false;
    }
    await this.storePicture(artistId, body, provider, pageUrl);
    return true;
  }

  private async storePicture(artistId: string, body: Buffer, source: string, sourceUrl: string | null): Promise<void> {
    let image: ProcessedImage;
    try {
      image = await this.images.normalizeArtwork(body);
    } catch {
      throw new BadRequestException("That image can't be read");
    }
    const { hash } = await this.storage.put(image.body, image.contentType);
    const before = await this.prisma.client.artist.findUniqueOrThrow({ where: { id: artistId }, select: { imageStorageKey: true } });
    await this.prisma.client.artist.update({ where: { id: artistId }, data: { imageStorageKey: hash, imageSource: source, imageSourceUrl: sourceUrl } });
    if (before.imageStorageKey && before.imageStorageKey !== hash) await this.storage.deleteUnreferenced([before.imageStorageKey]);
  }
}

/** A lookup step that isn't asked for. */
class Skip extends Error {}
