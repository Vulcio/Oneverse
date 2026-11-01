import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, NotFoundException } from "@nestjs/common";
import { compareEntryCodes, confidentMatch, MetadataMatchSchema, readSongDocument, songInfoProposals, type MetadataMatch, type SongInfoField, type SongbookSongInfo, type SongInfoRefreshSong, type SongInfoRefreshView } from "@oneverse/core";
import type { Queue } from "bullmq";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { SONG_INFO_QUEUE } from "../jobs/jobs.constants.js";
import { MetadataService } from "../metadata/metadata.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { SongInfoJobData } from "./song-info.js";
import { SongVersionsService } from "./song-versions.service.js";

/** One song's result, as a refresh keeps it. */
export interface RefreshResult {
  songVersionId: string;
  outcome: Exclude<SongInfoRefreshSong["outcome"], "waiting">;
  match?: MetadataMatch;
}

const SONG_SELECT = {
  id: true,
  title: true,
  album: true,
  year: true,
  ccli: true,
  copyright: true,
  isrc: true,
  imageStorageKey: true,
  documentJson: true,
  ownerScope: true,
  ownerUserId: true,
  ownerTeamId: true,
  publicationState: true,
  contributors: { select: { source: true, roles: true }, orderBy: { displayOrder: "asc" as const } },
  identifiers: { where: { type: "METADATA_MATCH" as const }, select: { id: true } },
};

/**
 * A songbook's songs and their details (issue #353): read in one list to
 * edit in place, and looked up again at the metadata providers in one pass
 * - a refresh, run by the Worker one song at a time, then reviewed: what
 * each match would change is worked out when it's read, against the song
 * as it is then, and only what's ticked is written.
 */
@Injectable()
export class SongbookSongInfoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly songs: SongVersionsService,
    private readonly metadata: MetadataService,
    @InjectQueue(SONG_INFO_QUEUE) private readonly queue: Queue<SongInfoJobData | { refreshId: string }>,
  ) {}

  private async entries(songbookId: string) {
    const songbook = await this.prisma.client.songbook.findUnique({ where: { id: songbookId }, select: { id: true } });
    if (!songbook) throw new NotFoundException("Songbook not found");
    const entries = await this.prisma.client.songbookEntry.findMany({
      where: { songbookId, songVersion: { deletedAt: null } },
      select: { id: true, entryCode: true, createdAt: true, songVersion: { select: SONG_SELECT } },
    });
    return entries.sort((a, b) =>
      a.entryCode !== null && b.entryCode !== null ? compareEntryCodes(a.entryCode, b.entryCode) : a.entryCode !== b.entryCode ? (a.entryCode === null ? 1 : -1) : a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  /** Who may change each song, at once: its editors, or those it's shared with to edit. */
  private async editable(user: AuthenticatedUser, songs: Parameters<AccessPolicyService["canEditContent"]>[1][]): Promise<Set<string>> {
    const can = new Set<string>();
    for (let i = 0; i < songs.length; i += 50) {
      const batch = songs.slice(i, i + 50);
      const answers = await Promise.all(batch.map((song) => this.access.canEditContent(user, song)));
      batch.forEach((song, index) => answers[index] && can.add(song.id));
    }
    return can;
  }

  async table(user: AuthenticatedUser, songbookId: string): Promise<SongbookSongInfo[]> {
    const entries = await this.entries(songbookId);
    const can = await this.editable(user, entries.map((e) => e.songVersion));
    return entries.map(({ id, entryCode, songVersion: song }) => {
      const doc = readSongDocument(song.documentJson);
      const named = (roles: string[]) => song.contributors.filter((c) => c.source && c.roles.some((role) => roles.includes(role))).map((c) => c.source!);
      const signature = doc.defaults.timeSignature;
      return {
        entryId: id,
        songVersionId: song.id,
        entryCode,
        title: song.title,
        artists: named(["PERFORMER"]),
        writers: named(["AUTHOR", "COMPOSER", "LYRICIST"]),
        album: song.album,
        year: song.year,
        key: doc.defaults.key ?? null,
        tempo: doc.defaults.tempo ?? null,
        timeSignature: signature ? `${signature.numerator}/${signature.denominator}` : null,
        durationSeconds: doc.defaults.durationSeconds ?? null,
        ccli: song.ccli,
        copyright: song.copyright,
        isrc: song.isrc,
        hasImage: !!song.imageStorageKey,
        linked: song.identifiers.length > 0,
        canEdit: can.has(song.id),
        canSuggest: !can.has(song.id) && song.ownerScope === "GLOBAL",
        revision: doc.revision,
      };
    });
  }

  /** Starts a refresh of its songs (or those listed), unless one is waiting or running: that one, then. */
  async start(user: AuthenticatedUser, songbookId: string, songVersionIds?: string[]): Promise<SongInfoRefreshView> {
    const running = await this.prisma.client.songInfoRefresh.findFirst({ where: { songbookId, status: { in: ["queued", "running"] } }, orderBy: { createdAt: "desc" } });
    if (running) return this.view(user, songbookId, running.id);
    const entries = await this.entries(songbookId);
    const wanted = songVersionIds ? new Set(songVersionIds) : null;
    const songs = [...new Set(entries.map((e) => e.songVersion.id).filter((id) => !wanted || wanted.has(id)))];
    const refresh = await this.prisma.client.songInfoRefresh.create({ data: { songbookId, requestedById: user.id, total: songs.length, results: songs.map((songVersionId) => ({ songVersionId, outcome: "waiting" })) } });
    await this.queue.add("refresh", { refreshId: refresh.id }, { jobId: `refresh-${refresh.id}`, removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } });
    return this.view(user, songbookId, refresh.id);
  }

  async latest(user: AuthenticatedUser, songbookId: string): Promise<{ refresh: SongInfoRefreshView | null }> {
    const last = await this.prisma.client.songInfoRefresh.findFirst({ where: { songbookId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    return { refresh: last ? await this.view(user, songbookId, last.id) : null };
  }

  async view(user: AuthenticatedUser, songbookId: string, refreshId: string): Promise<SongInfoRefreshView> {
    const refresh = await this.prisma.client.songInfoRefresh.findFirst({ where: { id: refreshId, songbookId } });
    if (!refresh) throw new NotFoundException("Refresh not found");
    const results = refresh.results as unknown as (RefreshResult | { songVersionId: string; outcome: "waiting" })[];
    const entries = await this.entries(songbookId);
    const bySong = new Map(entries.map((e) => [e.songVersion.id, e]));
    const can = await this.editable(user, entries.map((e) => e.songVersion).filter((song) => results.some((r) => r.songVersionId === song.id)));
    const songs: SongInfoRefreshSong[] = [];
    for (const result of results) {
      const entry = bySong.get(result.songVersionId);
      if (!entry) continue;
      const parsed = "match" in result && result.match ? MetadataMatchSchema.safeParse(result.match) : null;
      const match = parsed?.success ? parsed.data : null;
      songs.push({
        songVersionId: result.songVersionId,
        entryCode: entry.entryCode,
        title: entry.songVersion.title,
        outcome: result.outcome,
        match,
        proposals: match ? songInfoProposals(await this.songs.songInfoOf(result.songVersionId), match) : [],
        canEdit: can.has(result.songVersionId),
      });
    }
    return {
      id: refresh.id,
      status: refresh.status as SongInfoRefreshView["status"],
      total: refresh.total,
      done: refresh.done,
      createdAt: refresh.createdAt.toISOString(),
      finishedAt: refresh.finishedAt?.toISOString() ?? null,
      songs,
    };
  }

  /** Writes what was ticked, song by song, each one only if the user may change it. */
  async apply(user: AuthenticatedUser, songbookId: string, refreshId: string, chosen: { songVersionId: string; fields: SongInfoField[] }[]) {
    const refresh = await this.prisma.client.songInfoRefresh.findFirst({ where: { id: refreshId, songbookId } });
    if (!refresh) throw new NotFoundException("Refresh not found");
    const results = new Map((refresh.results as unknown as RefreshResult[]).map((r) => [r.songVersionId, r]));
    const entries = await this.entries(songbookId);
    const can = await this.editable(user, entries.map((e) => e.songVersion).filter((song) => chosen.some((c) => c.songVersionId === song.id)));
    const applied: { songVersionId: string; fields: SongInfoField[] }[] = [];
    const refused: string[] = [];
    for (const { songVersionId, fields } of chosen) {
      const parsed = MetadataMatchSchema.safeParse(results.get(songVersionId)?.match);
      if (!can.has(songVersionId) || !parsed.success) {
        refused.push(songVersionId);
        continue;
      }
      const written = await this.songs.applyFromMatch(songVersionId, parsed.data, fields, user.id);
      await this.songs.saveMetadataLink(songVersionId, parsed.data, { artwork: fields.includes("artwork") });
      applied.push({ songVersionId, fields: fields.includes("artwork") && parsed.data.artworkUrl ? [...written, "artwork"] : written });
    }
    return { applied, refused };
  }

  /** The Worker's part (SongInfoProcessor): each song looked up, its result kept as it goes. */
  async run(refreshId: string): Promise<{ found: number; total: number }> {
    const refresh = await this.prisma.client.songInfoRefresh.findUnique({ where: { id: refreshId } });
    if (!refresh) return { found: 0, total: 0 };
    await this.prisma.client.songInfoRefresh.update({ where: { id: refreshId }, data: { status: "running" } });
    const results = refresh.results as unknown as { songVersionId: string; outcome: string; match?: MetadataMatch }[];
    let found = 0;
    try {
      for (let i = 0; i < results.length; i++) {
        results[i] = await this.lookUp(results[i]!.songVersionId);
        if (results[i]!.outcome === "found") found++;
        await this.prisma.client.songInfoRefresh.update({ where: { id: refreshId }, data: { done: i + 1, results: results as object[] } });
      }
      await this.prisma.client.songInfoRefresh.update({ where: { id: refreshId }, data: { status: "done", finishedAt: new Date() } });
    } catch (err) {
      await this.prisma.client.songInfoRefresh.update({ where: { id: refreshId }, data: { status: "failed", finishedAt: new Date() } });
      throw err;
    }
    return { found, total: results.length };
  }

  /** A song linked to song info has that looked up again; one that isn't, a match with the same title and artist. */
  private async lookUp(songVersionId: string): Promise<RefreshResult> {
    try {
      const linked = await this.prisma.client.songVersionIdentifier.findFirst({ where: { songVersionId, type: "METADATA_MATCH" }, select: { details: true } });
      const saved = linked && MetadataMatchSchema.safeParse(linked.details);
      if (saved?.success) return { songVersionId, outcome: "found", match: await this.metadata.lookup(saved.data.sources) };
      const current = await this.songs.songInfoOf(songVersionId);
      const artist = current.artists[0];
      if (!artist) return { songVersionId, outcome: "no-artist" };
      const { matches } = await this.metadata.search(current.title, artist);
      const chosen = confidentMatch(matches, current.title, artist);
      if (!chosen) return { songVersionId, outcome: "no-close-match" };
      return { songVersionId, outcome: "found", match: await this.metadata.lookup(chosen.sources) };
    } catch (err) {
      const unavailable = err instanceof Error && /unavailable|turned on/i.test(err.message);
      return { songVersionId, outcome: unavailable ? "providers-unavailable" : "failed" };
    }
  }
}
