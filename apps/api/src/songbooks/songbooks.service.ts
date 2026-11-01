import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  compareEntryCodes,
  computeSectionLabel,
  limitSongbookHits,
  partialEntryDigits,
  rankSongbookHits,
  SONGBOOK_HIT_LIMITS,
  normalizeEntryCode,
  parseOriginalSongReference,
  songbookReferences,
  validateSongbookSections,
  type SongbookSection,
} from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AccessPolicyService } from "../access/access-policy.service.js";
import { SongVersionsService, type SongVersionOwner } from "../song-versions/song-versions.service.js";
import type { AddSongbookEntryDto } from "./dto/add-songbook-entry.dto.js";
import type { CreateSongbookDto } from "./dto/create-songbook.dto.js";
import type { ImportSongbookFromCatalogDto } from "./dto/import-songbook-from-catalog.dto.js";
import type { UpdateSongbookDto } from "./dto/update-songbook.dto.js";
import { SetlistAccessService } from "../setlists/setlist-access.service.js";
import { SongOwnershipService } from "../setlists/song-ownership.service.js";

const DETAIL_INCLUDE = {
  entries: {
    // Not those in the bin (issue #340): back when the song's put back.
    where: { songVersion: { deletedAt: null } },
    include: { songVersion: { select: { title: true } } },
  },
} satisfies Prisma.SongbookInclude;

type SongbookWithEntries = Prisma.SongbookGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function byEntryCode(a: { entryCode: string | null; createdAt: Date }, b: { entryCode: string | null; createdAt: Date }): number {
  if (a.entryCode !== null && b.entryCode !== null) return compareEntryCodes(a.entryCode, b.entryCode);
  if (a.entryCode !== b.entryCode) return a.entryCode === null ? 1 : -1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

function toDetail(songbook: SongbookWithEntries) {
  const { entries, ...rest } = songbook;
  const sections = (songbook.sections as SongbookSection[] | null) ?? null;
  return {
    ...rest,
    sections,
    // In reading order (2 before 10), which the database's text order isn't; unnumbered ones as added.
    entries: [...entries].sort(byEntryCode).map((entry) => ({
      id: entry.id,
      songVersionId: entry.songVersionId,
      entryCode: entry.entryCode,
      songVersionTitle: entry.songVersion.title,
      sectionLabel: computeSectionLabel(entry.entryCode, sections),
    })),
  };
}

@Injectable()
export class SongbooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly songVersionsService: SongVersionsService,
    private readonly access: AccessPolicyService,
    private readonly storage: StorageService,
    private readonly sets: SetlistAccessService,
    private readonly ownership: SongOwnershipService,
  ) {}

  /**
   * Songbook entries a search reads as a reference - "HY 42", "Hymns 42",
   * "42" (issue #48) - in songbooks the user can see, whose songs they can
   * see too: exactly that number, then numbers starting with it, then
   * containing it (issue #213), ranked by @oneverse/core's
   * rankSongbookHits() as offline search ranks them; `more` for Show more,
   * `addableTo` a set's id for the songs that can go in it.
   */
  async searchEntries(user: AuthenticatedUser, query: string, more = false, addableTo?: string) {
    const references = songbookReferences(query);
    if (references.length === 0) return [];
    // Only songs that can go in that set, for its Add songs (issue #328).
    const songsWhere = async () => (addableTo ? this.sets.pickableWhere(user, await this.sets.findEditable(user, addableTo)) : this.access.songsVisibleTo(user));
    const [books, songs] = await Promise.all([this.access.songbooksVisibleTo(user), songsWhere()]);
    // The numbers asked for, and (from two digits) the ones containing their digits (issue #213).
    const exact = references.flatMap((reference) => [...new Set([reference.code, normalizeEntryCode(reference.code)])].map((code) => ({ entryCode: { equals: code, mode: "insensitive" as const } })));
    const partial = partialEntryDigits(query).map((digits) => ({ entryCode: { contains: digits } }));
    const rows = await this.prisma.client.songbookEntry.findMany({
      where: { AND: [{ songbook: books }, { songVersion: songs }, { OR: [...exact, ...partial] }] },
      select: {
        entryCode: true,
        songbook: { select: { id: true, name: true, abbreviation: true, sections: true } },
        songVersion: { select: { id: true, title: true } },
      },
      take: 2000,
    });
    const limits = more ? { exact: 50, prefix: 100, contains: 100 } : SONGBOOK_HIT_LIMITS;
    return limitSongbookHits(rankSongbookHits(query, rows), limits).map((row) => ({
      songbookId: row.songbook.id,
      songbookName: row.songbook.name,
      abbreviation: row.songbook.abbreviation,
      entryCode: row.entryCode!,
      sectionLabel: computeSectionLabel(row.entryCode, row.songbook.sections as SongbookSection[] | null),
      songVersionId: row.songVersion.id,
      title: row.songVersion.title,
      match: row.match,
    }));
  }

  async findVisibleToUser(user: AuthenticatedUser) {
    const [songbooks, accessOf] = await Promise.all([
      this.prisma.client.songbook.findMany({ where: await this.access.songbooksVisibleTo(user), orderBy: { name: "asc" } }),
      this.accessChecker(user),
    ]);
    return songbooks.map((songbook) => ({ ...songbook, access: accessOf(songbook) }));
  }

  /**
   * A catalogue's entries already songs in the songbooks the user can see
   * that were started from it (issue #210), matched by number; and those
   * songbooks, for "Start" on the rest.
   */
  async catalogLibrary(user: AuthenticatedUser, catalogId: string) {
    const [songbooks, accessOf] = await Promise.all([
      this.prisma.client.songbook.findMany({
        where: { AND: [await this.access.songbooksVisibleTo(user), { sourceCatalogId: catalogId }] },
        orderBy: { name: "asc" },
        select: { id: true, name: true, ownerScope: true, ownerUserId: true, ownerTeamId: true },
      }),
      this.accessChecker(user),
    ]);
    const withAccess = songbooks
      .map((songbook) => ({ id: songbook.id, name: songbook.name, access: accessOf(songbook) }))
      // The ones they may add to first: that's where Start makes the song.
      .sort((a, b) => Number(a.access === "view") - Number(b.access === "view"));
    if (songbooks.length === 0) return { songbooks: withAccess, songs: [] };
    const [entries, catalogEntries] = await Promise.all([
      this.prisma.client.songbookEntry.findMany({
        where: { songbookId: { in: songbooks.map((songbook) => songbook.id) }, entryCode: { not: null } },
        select: { entryCode: true, songbookId: true, songVersion: { select: { id: true, title: true } } },
      }),
      this.prisma.client.songbookCatalogEntry.findMany({ where: { catalogId }, select: { id: true, entryCode: true } }),
    ]);
    const idOf = new Map(catalogEntries.map((entry) => [entry.entryCode, entry.id]));
    const order = new Map(withAccess.map((songbook, index) => [songbook.id, index]));
    const songs = entries
      .filter((entry) => idOf.has(entry.entryCode!))
      .sort((a, b) => order.get(a.songbookId)! - order.get(b.songbookId)!)
      .map((entry) => ({
        catalogEntryId: idOf.get(entry.entryCode!)!,
        entryCode: entry.entryCode!,
        songbookId: entry.songbookId,
        songbookName: withAccess[order.get(entry.songbookId)!]!.name,
        songVersionId: entry.songVersion.id,
        title: entry.songVersion.title,
      }));
    return { songbooks: withAccess, songs };
  }

  /**
   * What the user may do with each songbook (issue #211): "own" it (change,
   * share and delete it - its owner, its team's admins), "edit" it (shared
   * to edit: its entries and details), or only "view" it.
   */
  private async accessChecker(user: AuthenticatedUser): Promise<(songbook: { id: string; ownerScope: string; ownerUserId: string | null; ownerTeamId: string | null }) => "own" | "edit" | "view"> {
    const [owns, teamIds] = await Promise.all([this.access.editChecker(user), this.access.teamIds(user.id)]);
    const shares = await this.prisma.client.songbookShare.findMany({
      where: { OR: [{ userId: user.id }, ...(teamIds.length ? [{ teamId: { in: teamIds } }] : [])] },
      select: { songbookId: true, canEdit: true },
    });
    const editable = new Set(shares.filter((share) => share.canEdit).map((share) => share.songbookId));
    return (songbook) => (owns(songbook) ? "own" : editable.has(songbook.id) ? "edit" : "view");
  }

  /** Throws unless the user owns the songbook (its owner, its team's admins): deleting and sharing it. */
  async assertOwns(user: AuthenticatedUser, songbookId: string) {
    const songbook = await this.prisma.client.songbook.findUnique({ where: { id: songbookId }, select: { ownerScope: true, ownerUserId: true, ownerTeamId: true } });
    if (!songbook) throw new NotFoundException("Songbook not found");
    await this.access.assertCanEdit(user, songbook, "songbook");
  }


  async findOne(user: AuthenticatedUser, songbookId: string) {
    const songbook = await this.prisma.client.songbook.findUnique({
      where: { id: songbookId },
      include: DETAIL_INCLUDE,
    });
    if (!songbook) throw new NotFoundException("Songbook not found");
    await this.assertVisible(user, songbook);

    // A songbook imported from a catalog (see docs/songbooks-and-catalog.md
    // §6) doesn't eagerly materialize every entry - a "pending" entry is a
    // catalog entry with no matching SongbookEntry yet, offered here so the
    // UI can let the owner "start" it on demand.
    let pendingEntries: { catalogEntryId: string; entryCode: string; title: string }[] = [];
    if (songbook.sourceCatalogId) {
      const materializedCodes = new Set(
        songbook.entries.map((entry) => entry.entryCode).filter((code): code is string => code !== null),
      );
      const catalogEntries = await this.prisma.client.songbookCatalogEntry.findMany({
        where: { catalogId: songbook.sourceCatalogId },
      });
      pendingEntries = catalogEntries
        .filter((entry) => !materializedCodes.has(entry.entryCode))
        .sort((a, b) => compareEntryCodes(a.entryCode, b.entryCode))
        .map((entry) => ({ catalogEntryId: entry.id, entryCode: entry.entryCode, title: entry.title }));
    }

    // The catalogue's printed volumes, when they differ from the songbook's:
    // offered ("Use the catalogue's volumes"), never applied silently (issue #55).
    let catalogSections: SongbookSection[] | null = null;
    if (songbook.sourceCatalogId) {
      const catalog = await this.prisma.client.songbookCatalog.findUnique({ where: { id: songbook.sourceCatalogId }, select: { sections: true } });
      const sections = (catalog?.sections as SongbookSection[] | null) ?? null;
      const key = (list: SongbookSection[] | null) => JSON.stringify((list ?? []).map(({ label, start, end }) => [label, start, end]));
      if (sections?.length && key(sections) !== key(songbook.sections as SongbookSection[] | null)) catalogSections = sections;
    }

    // Shared with them themselves (not only through a team): theirs to leave (issue #211).
    const sharedWithMe = (await this.prisma.client.songbookShare.count({ where: { songbookId, userId: user.id } })) > 0;
    return { ...toDetail(songbook), pendingEntries, catalogSections, access: (await this.accessChecker(user))(songbook), sharedWithMe };
  }

  private async assertVisible(
    user: AuthenticatedUser,
    songbook: { ownerScope: string; ownerUserId: string | null; ownerTeamId: string | null },
  ): Promise<void> {
    if (!(await this.access.canSeeSongbook(user, songbook))) throw new ForbiddenException("Not visible to you");
  }

  async create(user: AuthenticatedUser, dto: CreateSongbookDto): Promise<Prisma.SongbookGetPayload<object>> {
    const owner = await this.resolveOwnership(user, { teamId: dto.teamId, global: dto.global });
    return this.prisma.client.songbook.create({
      data: {
        name: dto.name,
        kind: dto.kind,
        abbreviation: dto.abbreviation,
        language: dto.language,
        publisher: dto.publisher,
        year: dto.year,
        ...owner,
      },
    });
  }

  /**
   * Same USER/TEAM/GLOBAL choice used by create() and by importFromCatalog()
   * - a songbook imported from a catalog is still owned like any other
   * songbook, it just starts out with pending entries instead of none.
   */
  private async resolveOwnership(
    user: AuthenticatedUser,
    opts: { teamId?: string; global?: boolean },
  ): Promise<SongVersionOwner> {
    if (opts.global) {
      if (!user.isGlobalAdmin) throw new ForbiddenException("Only global admins can create a global songbook");
      return { ownerScope: "GLOBAL", ownerUserId: null, ownerTeamId: null };
    }
    if (opts.teamId) {
      if (!(await this.access.teamRole(user.id, opts.teamId))) throw new ForbiddenException("Not a member of this team");
      await this.access.assertSongverseTeam(opts.teamId);
      return { ownerScope: "TEAM", ownerUserId: null, ownerTeamId: opts.teamId };
    }
    return { ownerScope: "USER", ownerUserId: user.id, ownerTeamId: null };
  }

  /**
   * Creates a new songbook linked to a catalog (docs/songbooks-and-catalog.md
   * §6). Always NUMBERED, since a catalog's entries carry a real entryCode
   * matching the printed edition. No entries are created here - they're
   * materialized lazily via materializeEntry() as the owner works through
   * findOne()'s pendingEntries list.
   */
  async importFromCatalog(
    user: AuthenticatedUser,
    dto: ImportSongbookFromCatalogDto,
  ): Promise<Prisma.SongbookGetPayload<object>> {
    const catalog = await this.prisma.client.songbookCatalog.findUnique({ where: { id: dto.catalogId } });
    if (!catalog) throw new NotFoundException("Songbook catalog not found");
    const owner = await this.resolveOwnership(user, { teamId: dto.teamId, global: dto.global });

    return this.prisma.client.songbook.create({
      data: {
        name: catalog.name,
        kind: "NUMBERED",
        abbreviation: catalog.abbreviation,
        language: catalog.language,
        publisher: catalog.publisher,
        // The printed volumes, which the songbook can still adjust (issue #55).
        sections: catalog.sections ?? Prisma.JsonNull,
        sourceCatalogId: catalog.id,
        ...owner,
      },
    });
  }

  /**
   * Turns one pending catalog entry into a real, editable song: mints a
   * blank SongVersion under the songbook's own ownership and links it in
   * with the catalog entry's number. The user still has to add lyrics/
   * chords themselves - the catalog never carries copyrighted content.
   */
  async materializeEntry(songbookId: string, catalogEntryId: string) {
    const songbook = await this.prisma.client.songbook.findUnique({ where: { id: songbookId } });
    if (!songbook) throw new NotFoundException("Songbook not found");
    if (!songbook.sourceCatalogId) {
      throw new BadRequestException("This songbook was not imported from a catalog");
    }

    const catalogEntry = await this.prisma.client.songbookCatalogEntry.findUnique({
      where: { id: catalogEntryId },
    });
    if (!catalogEntry || catalogEntry.catalogId !== songbook.sourceCatalogId) {
      throw new NotFoundException("Catalog entry not found in this songbook's catalog");
    }

    const existing = await this.prisma.client.songbookEntry.findUnique({
      where: { songbookId_entryCode: { songbookId, entryCode: catalogEntry.entryCode } },
    });
    if (existing) throw new ConflictException("This catalog entry has already been imported");

    const owner = { ownerScope: songbook.ownerScope, ownerUserId: songbook.ownerUserId, ownerTeamId: songbook.ownerTeamId };
    const version = await this.songVersionsService.createFromCatalogEntry(
      owner,
      catalogEntry,
      songbook.language ?? catalogEntry.originalLanguage ?? "en",
      await this.findOriginalSong(owner, catalogEntry),
    );

    const entry = await this.prisma.client.songbookEntry.create({
      data: { songbookId, songVersionId: version.id, entryCode: catalogEntry.entryCode },
    });

    return {
      id: entry.id,
      songVersionId: entry.songVersionId,
      entryCode: entry.entryCode,
      songVersionTitle: version.title,
      sectionLabel: computeSectionLabel(entry.entryCode, songbook.sections as SongbookSection[] | null),
    };
  }

  /**
   * Every entry code bulk upload (docs/songbooks-and-catalog.md §7) can
   * match a filename against: real entries already in the songbook, plus
   * (for a catalog-imported songbook) codes still pending materialization.
   * A pending code is included because uploading content for it is itself
   * the "start" - no separate step needed to reconcile a lazy stub with
   * bulk content.
   */
  async entryCodesFor(songbookId: string): Promise<string[]> {
    const songbook = await this.prisma.client.songbook.findUnique({
      where: { id: songbookId },
      select: { sourceCatalogId: true },
    });
    if (!songbook) throw new NotFoundException("Songbook not found");

    const existingEntries = await this.prisma.client.songbookEntry.findMany({
      where: { songbookId, entryCode: { not: null } },
      select: { entryCode: true },
    });
    const codes = new Set(existingEntries.map((entry) => entry.entryCode!));

    if (songbook.sourceCatalogId) {
      const catalogEntries = await this.prisma.client.songbookCatalogEntry.findMany({
        where: { catalogId: songbook.sourceCatalogId },
        select: { entryCode: true },
      });
      for (const entry of catalogEntries) codes.add(entry.entryCode);
    }
    return [...codes];
  }

  /**
   * Resolves an entry code to the SongVersion content should be attached
   * to, materializing a pending catalog entry on demand exactly like
   * materializeEntry() does interactively. Returns null when there's no
   * entry - existing or catalog-backed - for that code, so the caller
   * (the bulk upload processor) can skip it rather than guess.
   */
  async ensureEntryForCode(songbookId: string, entryCode: string): Promise<{ songVersionId: string } | null> {
    const songbook = await this.prisma.client.songbook.findUnique({ where: { id: songbookId } });
    if (!songbook) return null;

    const existing = await this.prisma.client.songbookEntry.findUnique({
      where: { songbookId_entryCode: { songbookId, entryCode } },
    });
    if (existing) return { songVersionId: existing.songVersionId };
    if (!songbook.sourceCatalogId) return null;

    const catalogEntry = await this.prisma.client.songbookCatalogEntry.findUnique({
      where: { catalogId_entryCode: { catalogId: songbook.sourceCatalogId, entryCode } },
    });
    if (!catalogEntry) return null;

    const owner = { ownerScope: songbook.ownerScope, ownerUserId: songbook.ownerUserId, ownerTeamId: songbook.ownerTeamId };
    const version = await this.songVersionsService.createFromCatalogEntry(
      owner,
      catalogEntry,
      songbook.language ?? catalogEntry.originalLanguage ?? "en",
      await this.findOriginalSong(owner, catalogEntry),
    );
    const created = await this.prisma.client.songbookEntry.create({
      data: { songbookId, songVersionId: version.id, entryCode },
    });
    return { songVersionId: created.songVersionId };
  }

  /**
   * The song a catalogue entry's "Original song" ("JEM 245", or "245" in
   * the same catalogue) has become in one of the same owner's songbooks
   * imported from that catalogue - so a translation can join its Work.
   * Null when that entry hasn't become a song there (yet).
   */
  private async findOriginalSong(
    owner: SongVersionOwner,
    entry: { catalogId: string; originalSong: string | null },
  ): Promise<{ id: string; workId: string } | null> {
    const reference = entry.originalSong ? parseOriginalSongReference(entry.originalSong) : null;
    if (!reference) return null;
    const catalog = reference.abbreviation
      ? await this.prisma.client.songbookCatalog.findFirst({
          where: { abbreviation: { equals: reference.abbreviation, mode: "insensitive" } },
          select: { id: true },
        })
      : { id: entry.catalogId };
    if (!catalog) return null;
    const found = await this.prisma.client.songbookEntry.findFirst({
      where: {
        entryCode: reference.entryCode,
        songbook: { sourceCatalogId: catalog.id, ownerScope: owner.ownerScope, ownerUserId: owner.ownerUserId, ownerTeamId: owner.ownerTeamId },
      },
      select: { songVersion: { select: { id: true, workId: true } } },
      orderBy: { createdAt: "asc" },
    });
    return found?.songVersion ?? null;
  }

  update(songbookId: string, dto: UpdateSongbookDto): Promise<Prisma.SongbookGetPayload<object>> {
    let sections: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
    if (dto.sections !== undefined) {
      try {
        sections = validateSongbookSections(dto.sections) as unknown as Prisma.InputJsonValue;
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : String(error));
      }
    }

    return this.prisma.client.songbook.update({
      where: { id: songbookId },
      data: { ...dto, sections },
    });
  }

  async remove(songbookId: string): Promise<void> {
    const { avatarStorageKey } = await this.prisma.client.songbook.delete({ where: { id: songbookId }, select: { avatarStorageKey: true } });
    if (avatarStorageKey) await this.storage.deleteUnreferenced([avatarStorageKey]);
  }

  async addEntry(user: AuthenticatedUser, songbookId: string, dto: AddSongbookEntryDto) {
    // Only a song the user can see: a songbook shared with others opens its songs to them (issue #211).
    await this.access.assertCanSeeSong(user, dto.songVersionId);
    const songbook = await this.prisma.client.songbook.findUnique({
      where: { id: songbookId },
      select: { kind: true, sections: true, ownerTeamId: true },
    });
    if (!songbook) throw new NotFoundException("Songbook not found");
    if (songbook.ownerTeamId) await this.forTeam(user, songbook.ownerTeamId, dto.songVersionId, dto.teamAccess);
    else if (dto.teamAccess) throw new BadRequestException("teamAccess is only for one of your personal songs in a team's songbook");
    if (songbook.kind === "NUMBERED" && !dto.entryCode) {
      throw new BadRequestException("entryCode is required for a NUMBERED songbook");
    }
    // Stored without a plain number's leading zeros (issue #55).
    const entryCode = songbook.kind === "NUMBERED" ? normalizeEntryCode(dto.entryCode!) : null;

    const songVersion = await this.prisma.client.songVersion.findUnique({
      where: { id: dto.songVersionId },
      select: { id: true, title: true },
    });
    if (!songVersion) throw new NotFoundException("Song version not found");

    const entry = await this.prisma.client.songbookEntry
      .create({
        data: { songbookId, songVersionId: dto.songVersionId, entryCode },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictException("This song is already in this songbook, or its number is already taken");
        }
        throw error;
      });
    return {
      id: entry.id,
      songVersionId: entry.songVersionId,
      entryCode: entry.entryCode,
      songVersionTitle: songVersion.title,
      sectionLabel: computeSectionLabel(entry.entryCode, songbook.sections as SongbookSection[] | null),
    };
  }

  /**
   * A team's songbook takes only songs everyone in the team can open, as a
   * team's set does (issue #340): the team's, approved catalogue songs, and
   * those shared with it. One of the user's own personal songs is shared
   * with the team or moved to it, as `teamAccess` says; without it, refused
   * with SONG_NOT_SHARED so the app can ask.
   */
  private async forTeam(user: AuthenticatedUser, teamId: string, songVersionId: string, teamAccess: "share" | "move" | undefined): Promise<void> {
    const teamSees = await this.sets.addableWhere({ id: "", ownerUserId: null, ownerTeamId: teamId });
    if ((await this.prisma.client.songVersion.count({ where: { AND: [{ id: songVersionId }, teamSees] } })) > 0) {
      if (teamAccess) throw new BadRequestException("teamAccess is only for one of your personal songs in a team's songbook");
      return;
    }
    const song = await this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { ownerScope: true, ownerUserId: true } });
    const team = await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { id: true, name: true } });
    const teamName = team?.name ?? "the team";
    if (song?.ownerScope !== "USER" || song.ownerUserId !== user.id) throw new BadRequestException(`Only songs everyone in ${teamName} can open go in its songbook`);
    if (!teamAccess) throw new ConflictException({ code: "SONG_NOT_SHARED", message: `Share this song with ${teamName} to add it to the team's songbook`, team });
    if (teamAccess === "share") await this.ownership.shareWithTeam(user, songVersionId, teamId, false);
    else await this.ownership.move(user, songVersionId, teamId);
  }

  async removeEntry(songbookId: string, entryId: string): Promise<void> {
    const entry = await this.prisma.client.songbookEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.songbookId !== songbookId) throw new NotFoundException("Entry not found");
    await this.prisma.client.songbookEntry.delete({ where: { id: entryId } });
  }
}
