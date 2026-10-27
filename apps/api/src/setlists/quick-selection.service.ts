import { Injectable } from "@nestjs/common";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SetlistAccessService, SONG_SELECT } from "./setlist-access.service.js";
import { SetlistsService, toSongRef } from "./setlists.service.js";

/**
 * Someone's Quick selection (issue #334): songs gathered from anywhere -
 * a song, the library, the search box - then added to a set all at once.
 * Theirs alone, kept on their account. A song they can't see any more
 * (unshared since) isn't listed.
 */
@Injectable()
export class QuickSelectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccessPolicyService,
    private readonly sets: SetlistAccessService,
    private readonly setlists: SetlistsService,
  ) {}

  async get(user: AuthenticatedUser) {
    const rows = await this.prisma.client.quickSelectionSong.findMany({
      where: { userId: user.id, songVersion: await this.policy.songsVisibleTo(user) },
      orderBy: { addedAt: "asc" },
      select: { songVersion: { select: SONG_SELECT } },
    });
    return { songs: rows.map((row) => toSongRef(row.songVersion)) };
  }

  async add(user: AuthenticatedUser, songVersionId: string) {
    await this.policy.assertCanSeeSong(user, songVersionId);
    await this.prisma.client.quickSelectionSong.upsert({
      where: { userId_songVersionId: { userId: user.id, songVersionId } },
      create: { userId: user.id, songVersionId },
      update: {},
    });
    return this.get(user);
  }

  async remove(user: AuthenticatedUser, songVersionId?: string) {
    await this.prisma.client.quickSelectionSong.deleteMany({ where: { userId: user.id, ...(songVersionId && { songVersionId }) } });
    return this.get(user);
  }

  /**
   * Its songs into a set the user can change, at the end, in the order they
   * were gathered. One already in the set, or one that can't go in it (a
   * team set takes the team's songs), is skipped and said; the others leave
   * the selection unless `keep`.
   */
  async addTo(user: AuthenticatedUser, setlistId: string, keep = false) {
    const set = await this.sets.findEditable(user, setlistId);
    const { songs } = await this.get(user);
    const addable = new Set(
      (await this.prisma.client.songVersion.findMany({ where: { AND: [{ id: { in: songs.map((song) => song.id) } }, await this.sets.addableWhere(set)] }, select: { id: true } })).map((song) => song.id),
    );
    const inSet = new Set(
      (await this.prisma.client.setlistItem.findMany({ where: { setlistId, songVersionId: { in: songs.map((song) => song.id) } }, select: { songVersionId: true } })).map((item) => item.songVersionId),
    );
    const added: string[] = [];
    const skipped: { songVersionId: string; title: string; reason: "in-set" | "not-addable" }[] = [];
    for (const song of songs) {
      if (inSet.has(song.id)) skipped.push({ songVersionId: song.id, title: song.title, reason: "in-set" });
      else if (!addable.has(song.id)) skipped.push({ songVersionId: song.id, title: song.title, reason: "not-addable" });
      else {
        await this.setlists.addItem(user, setlistId, { songVersionId: song.id });
        added.push(song.id);
      }
    }
    // What's in the set now leaves the selection; what couldn't go in stays.
    if (!keep) {
      const gone = [...added, ...skipped.filter((song) => song.reason === "in-set").map((song) => song.songVersionId)];
      await this.prisma.client.quickSelectionSong.deleteMany({ where: { userId: user.id, songVersionId: { in: gone } } });
    }
    return { added: added.length, skipped, set: await this.setlists.findOne(user, setlistId), selection: await this.get(user) };
  }
}
