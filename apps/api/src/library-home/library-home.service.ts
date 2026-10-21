import { Injectable } from "@nestjs/common";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SongVersionsService, type ListItem } from "../song-versions/song-versions.service.js";

/** Songs per shelf. */
const SHELF = 12;
/** How far back "popular" looks. */
const POPULAR_DAYS = 90;
/** A view within this long of the last one doesn't count again. */
const VIEW_GAP_MS = 60 * 60 * 1000;

export interface LibraryHome {
  newest: ListItem[];
  recent: ListItem[];
  favorites: ListItem[];
  popular: ListItem[];
}

/**
 * The Library's home (issue #81): what's new, what the user looked at
 * lately, their favorites, and what's popular in their teams - in their
 * teams' sets and viewed by their members. Only songs the user can see.
 */
@Injectable()
export class LibraryHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly songs: SongVersionsService,
  ) {}

  async home(user: AuthenticatedUser): Promise<LibraryHome> {
    const visible = await this.access.songsVisibleTo(user);
    const [newest, recent, favorites, popular] = await Promise.all([
      this.prisma.client.songVersion.findMany({ where: visible, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: SHELF, select: { id: true } }),
      this.prisma.client.songView.findMany({ where: { userId: user.id, songVersion: visible }, orderBy: { viewedAt: "desc" }, take: SHELF, select: { songVersionId: true } }),
      this.prisma.client.favoriteSong.findMany({ where: { userId: user.id, songVersion: visible }, orderBy: { createdAt: "desc" }, take: SHELF, select: { songVersionId: true } }),
      this.popularIds(user),
    ]);
    const [newestItems, recentItems, favoriteItems, popularItems] = await Promise.all([
      this.songs.listItems(user, newest.map((row) => row.id)),
      this.songs.listItems(user, recent.map((row) => row.songVersionId)),
      this.songs.listItems(user, favorites.map((row) => row.songVersionId)),
      // Ranked on more than a shelf's worth, since some may not be visible to this user.
      this.songs.listItems(user, popular).then((items) => items.slice(0, SHELF)),
    ]);
    return { newest: newestItems, recent: recentItems, favorites: favoriteItems, popular: popularItems };
  }

  /**
   * The songs most played and looked at in the user's teams lately: twice
   * each time one is in a team's set (by its date, or when it was made
   * when it has none), and once for each member who viewed it.
   */
  private async popularIds(user: AuthenticatedUser): Promise<string[]> {
    const teamIds = await this.access.teamIds(user.id);
    if (teamIds.length === 0) return [];
    const since = new Date(Date.now() - POPULAR_DAYS * 24 * 3600 * 1000);
    const [inSets, viewed] = await Promise.all([
      this.prisma.client.setlistItem.groupBy({
        by: ["songVersionId"],
        where: { songVersionId: { not: null }, setlist: { ownerTeamId: { in: teamIds }, OR: [{ eventDate: { gte: since } }, { eventDate: null, createdAt: { gte: since } }] } },
        _count: { _all: true },
      }),
      this.prisma.client.songView.groupBy({
        by: ["songVersionId"],
        where: { viewedAt: { gte: since }, user: { teamMemberships: { some: { teamId: { in: teamIds } } } } },
        _count: { _all: true },
      }),
    ]);
    const score = new Map<string, number>();
    for (const row of inSets) if (row.songVersionId) score.set(row.songVersionId, (score.get(row.songVersionId) ?? 0) + 2 * row._count._all);
    for (const row of viewed) score.set(row.songVersionId, (score.get(row.songVersionId) ?? 0) + row._count._all);
    return [...score]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, SHELF * 3)
      .map(([id]) => id);
  }

  /** The user opened the song: their Recently viewed, and a view for their teams' Popular. */
  async view(user: AuthenticatedUser, songVersionId: string): Promise<void> {
    const now = new Date();
    await this.prisma.client.$executeRaw`
      INSERT INTO "SongView" ("userId", "songVersionId", "viewedAt", "count") VALUES (${user.id}, ${songVersionId}, ${now}, 1)
      ON CONFLICT ("userId", "songVersionId") DO UPDATE SET
        "count" = "SongView"."count" + CASE WHEN "SongView"."viewedAt" < ${new Date(now.getTime() - VIEW_GAP_MS)} THEN 1 ELSE 0 END,
        "viewedAt" = EXCLUDED."viewedAt"`;
  }

  async favorite(user: AuthenticatedUser, songVersionId: string, on: boolean): Promise<void> {
    if (on) {
      await this.prisma.client.favoriteSong.upsert({
        where: { userId_songVersionId: { userId: user.id, songVersionId } },
        create: { userId: user.id, songVersionId },
        update: {},
      });
    } else {
      await this.prisma.client.favoriteSong.deleteMany({ where: { userId: user.id, songVersionId } });
    }
  }
}
