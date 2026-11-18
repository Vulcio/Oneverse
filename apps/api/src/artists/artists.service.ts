import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { BIO_LANGUAGES, foldForSearch } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
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
  /** The other names they're credited under (issue #512); `name` is the main one. */
  otherNames: string[];
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

  /**
   * The artist each name is one of (issue #512), by the name's key, for the
   * names that belong to an artist with other names: its main name and key.
   * A name not in the map is an artist of its own.
   */
  async mainNames(keys: string[]): Promise<Map<string, { key: string; name: string }>> {
    const wanted = [...new Set(keys.filter(Boolean))];
    if (wanted.length === 0) return new Map();
    const [aliases, mains] = await Promise.all([
      this.prisma.client.artistName.findMany({ where: { key: { in: wanted } }, select: { key: true, artist: { select: { key: true, name: true } } } }),
      this.prisma.client.artist.findMany({ where: { key: { in: wanted }, names: { some: {} } }, select: { key: true, name: true } }),
    ]);
    const found = new Map<string, { key: string; name: string }>();
    for (const main of mains) found.set(main.key, { key: main.key, name: main.name });
    for (const alias of aliases) found.set(alias.key, { key: alias.artist.key, name: alias.artist.name });
    return found;
  }

  /** Every name of the artist `name` is one of (issue #512): the main one first; just `name` when it has no others. */
  async allNames(name: string): Promise<string[]> {
    const artist = await this.resolve(name);
    return artist ? [artist.name, ...artist.names.map((other) => other.name)] : [name.trim()];
  }

  /**
   * The other names of the artists credited as `credited` (issue #512),
   * by each credit's key: those the song isn't credited under already.
   */
  async otherNamesOf(credited: string[]): Promise<Map<string, string[]>> {
    const keys = [...new Set(credited.map(artistKey).filter(Boolean))];
    const mains = await this.mainNames(keys);
    if (mains.size === 0) return new Map();
    const artists = await this.prisma.client.artist.findMany({
      where: { key: { in: [...new Set([...mains.values()].map((main) => main.key))] } },
      select: { key: true, name: true, names: { select: { name: true, key: true }, orderBy: { name: "asc" } } },
    });
    const byKey = new Map(artists.map((artist) => [artist.key, [{ name: artist.name, key: artist.key }, ...artist.names]]));
    const result = new Map<string, string[]>();
    for (const key of keys) {
      const main = mains.get(key);
      const names = main && byKey.get(main.key);
      if (names) result.set(key, names.filter((other) => other.key !== key).map((other) => other.name));
    }
    return result;
  }

  /** The artists' names that contain `query` (folded), each artist's every name (issue #512: the artists list found by a name nobody's credited under). */
  async namesMatching(query: string): Promise<string[]> {
    const q = artistKey(query);
    if (!q) return [];
    const aliases = await this.prisma.client.artistName.findMany({ select: { key: true, artistId: true } });
    const ids = new Set(aliases.filter((alias) => alias.key.includes(q)).map((alias) => alias.artistId));
    const artists = await this.prisma.client.artist.findMany({
      where: { OR: [{ id: { in: [...ids] } }, { key: { contains: q }, names: { some: {} } }] },
      select: { name: true, names: { select: { name: true } } },
    });
    return artists.flatMap((artist) => [artist.name, ...artist.names.map((other) => other.name)]);
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
    const found = await this.resolve(name);
    const artist = found && (await this.prisma.client.artist.findUnique({ where: { id: found.id }, include: { bios: { orderBy: { language: "asc" } } } }));
    return {
      id: artist?.id ?? null,
      name: artist?.name ?? creditedAs,
      songCount,
      imageUrl: artist ? artistImageUrl(artist.id, artist.imageStorageKey) : null,
      imageSource: artist?.imageStorageKey ? artist.imageSource : null,
      imageSourceUrl: artist?.imageStorageKey ? artist.imageSourceUrl : null,
      bios: (artist?.bios ?? []).map((bio) => ({ text: bio.text, language: bio.language, sourceUrl: bio.sourceUrl, custom: bio.custom })),
      otherNames: (found?.names ?? []).map((other) => other.name),
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
    // Another name of an artist (issue #512): theirs.
    const existing = await this.resolve(name);
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
    // Another name of an artist (issue #512) is that artist, asked about once.
    const mains = await this.mainNames([...byKey.keys()]);
    for (const [key, main] of mains) {
      byKey.delete(key);
      byKey.set(main.key, main.name);
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
    const artist = await this.resolve(name);
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

  /**
   * An artist's names (issue #512): the main one - shown, and the one the
   * providers are asked about - and the others they're credited under. A
   * name that was an artist of its own joins this one: its other names
   * too, its picture and bios where this one has none. A name that's
   * another artist's other name is refused. Songs keep their credits; their
   * search text gets the names.
   */
  async saveNames(user: AuthenticatedUser, name: string, main: string, otherNames: string[]): Promise<ArtistDetail> {
    const { creditedAs } = await this.visibleSongs(user, name);
    const artist = await this.ensure(creditedAs);
    const before = [artist.name, ...(await this.prisma.client.artistName.findMany({ where: { artistId: artist.id }, select: { name: true } })).map((other) => other.name)];
    // Each name once, by key; the main one isn't one of the others. A name left out of the list is no longer theirs.
    const mainName = main.trim();
    const mainKey = artistKey(mainName);
    if (!mainKey) throw new BadRequestException("main must be a name");
    const others = new Map<string, string>();
    for (const other of otherNames) {
      const key = artistKey(other);
      if (key && key !== mainKey && !others.has(key)) others.set(key, other.trim());
    }
    const keys = [...others.keys()];
    const [taken, separate] = await Promise.all([
      this.prisma.client.artistName.findMany({ where: { key: { in: [...keys, mainKey] }, artistId: { not: artist.id } }, select: { name: true, artist: { select: { name: true } } } }),
      this.prisma.client.artist.findMany({ where: { key: { in: [...keys, mainKey] }, id: { not: artist.id } }, include: { bios: true, names: true } }),
    ]);
    if (taken.length > 0) throw new ConflictException(`${taken[0]!.name} is already another name of ${taken[0]!.artist.name}`);
    const merged = await this.prisma.client.$transaction(async (tx) => {
      const unreferenced: string[] = [];
      let current = await tx.artist.findUniqueOrThrow({ where: { id: artist.id }, include: { bios: true } });
      for (const other of separate) {
        // Its other names become this artist's.
        for (const alias of other.names) if (alias.key !== mainKey && !others.has(alias.key)) others.set(alias.key, alias.name);
        await tx.artistName.deleteMany({ where: { artistId: other.id } });
        if (!current.imageStorageKey && other.imageStorageKey) {
          current = await tx.artist.update({ where: { id: artist.id }, data: { imageStorageKey: other.imageStorageKey, imageSource: other.imageSource, imageSourceUrl: other.imageSourceUrl }, include: { bios: true } });
        } else if (other.imageStorageKey) unreferenced.push(other.imageStorageKey);
        for (const bio of other.bios) {
          if (current.bios.some((mine) => mine.language === bio.language)) continue;
          await tx.artistBio.create({ data: { artistId: artist.id, language: bio.language, text: bio.text, sourceUrl: bio.sourceUrl, custom: bio.custom } });
        }
        if (!current.musicbrainzId && other.musicbrainzId) await tx.artist.update({ where: { id: artist.id }, data: { musicbrainzId: other.musicbrainzId, wikidataId: other.wikidataId } });
        await tx.artist.delete({ where: { id: other.id } });
      }
      await tx.artistName.deleteMany({ where: { artistId: artist.id } });
      // A new main name: asked about again under it, as the providers know them by it.
      const renamed = artistKey(current.name) !== mainKey;
      await tx.artist.update({ where: { id: artist.id }, data: { key: mainKey, name: mainName, ...(renamed && { lookedUpAt: null }) } });
      if (others.size > 0) await tx.artistName.createMany({ data: [...others].map(([key, other]) => ({ artistId: artist.id, key, name: other })) });
      return unreferenced;
    });
    if (merged.length > 0) await this.storage.deleteUnreferenced(merged);
    await this.refreshSongSearch([...before, mainName, ...others.values(), ...separate.map((other) => other.name)]);
    return this.detail(user, mainName);
  }

  /** The search text of the songs credited under any of `names` again (issue #512): it holds their artists' other names. */
  private async refreshSongSearch(names: string[]): Promise<void> {
    const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    if (unique.length === 0) return;
    await this.prisma.client.$executeRaw`
      UPDATE "SongVersion" sv
         SET "searchText" = song_version_search_text(sv.id, sv.title, sv."alternateTitle", sv."versionName")
       WHERE sv.id IN (
         SELECT vc."songVersionId" FROM "VersionContributor" vc
          WHERE vc.roles @> ARRAY['PERFORMER']::"ContributorRole"[]
            AND vc.source IS NOT NULL
            AND lower(search_fold(vc.source)) IN (SELECT lower(search_fold(n)) FROM unnest(${unique}::text[]) AS n))`;
  }

  /** The artist `name` is (by their main name or another), with their other names; null when there's no such artist yet. */
  private async resolve(name: string) {
    const key = artistKey(name);
    if (!key) return null;
    const include = { names: { orderBy: { name: "asc" as const } } };
    const alias = await this.prisma.client.artistName.findUnique({ where: { key }, select: { artist: { include } } });
    return alias?.artist ?? (await this.prisma.client.artist.findUnique({ where: { key }, include }));
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
    const credit = await this.creditedAs(await this.allNames(clean));
    const where: Prisma.SongVersionWhereInput = { AND: [await this.access.songsVisibleTo(user), { contributors: { some: credit } }] };
    const [songCount, first] = await Promise.all([
      this.prisma.client.songVersion.count({ where }),
      this.prisma.client.versionContributor.findFirst({ where: { ...credit, songVersion: where }, select: { source: true } }),
    ]);
    if (songCount === 0 || !first?.source) throw new NotFoundException("No such artist");
    return { songCount, creditedAs: first.source.trim() };
  }

  /**
   * Credits as a performer under any of `names` - ignoring case and accents
   * as the database folds them (sourceSearch) - for the artist's songs and
   * the library's artist filter (issue #512: every name of theirs).
   */
  async creditedAs(names: string[]): Promise<Prisma.VersionContributorWhereInput> {
    const rows = await this.prisma.client.$queryRaw<{ folded: string }[]>`SELECT unaccent(n) AS folded FROM unnest(${names}::text[]) AS n`;
    const folded = [...new Set(rows.map((row) => row.folded))];
    return { roles: { has: "PERFORMER" }, OR: folded.map((name) => ({ sourceSearch: { equals: name, mode: "insensitive" as const } })) };
  }

  /** The artist row for `name`: the artist it's another name of (issue #512), else its own, made when there's none. */
  private async ensure(name: string) {
    const existing = await this.resolve(name);
    if (existing) return existing;
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
