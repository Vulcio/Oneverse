import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  NoteAnchorSchema,
  readSongDocument,
  resolveNoteAnchor,
  type NoteAnchor,
  type NotePlace,
  type NotePlaceChoice,
  type SongDocumentV2,
  type SongNote,
  type SongNotes,
} from "@songverse/core";
import type { Prisma } from "@songverse/db";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { redis } from "../jobs/redis.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateNoteDto, UpdateNoteDto } from "./notes.dto.js";
import { SONG_SELECT, SetlistAccessService, type SetRow } from "../setlists/setlist-access.service.js";

const AUTHOR = { select: { id: true, displayName: true, avatarUrl: true } } as const;

const NOTE_INCLUDE = {
  author: AUTHOR,
  team: { select: { name: true } },
  songbook: { select: { name: true, ownerScope: true, ownerUserId: true, ownerTeamId: true } },
  setlist: { select: { id: true, name: true, eventDate: true, ownerUserId: true, ownerTeamId: true } },
  replies: { orderBy: { createdAt: "asc" }, include: { author: AUTHOR } },
} satisfies Prisma.NoteInclude;

type NoteRow = Prisma.NoteGetPayload<{ include: typeof NOTE_INCLUDE }>;
/** Where a note is saved, as its row has it. */
type NotePlacement = { place: NotePlace; teamId: string | null; songbookId: string | null; setlistId: string | null };

type SongForNotes = {
  id: string;
  title: string;
  ownerScope: string;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  publicationState: string;
  documentJson: unknown;
};

/** The set a song was opened in, when it's there. */
interface SetContext {
  set: SetRow;
  canEdit: boolean;
  /** The song's first item in the set, for links. */
  itemId: string | null;
}

/**
 * Notes on songs (issues #104, #256). Where a note is saved decides who
 * sees it and where it shows:
 *
 * - ME: its author, wherever they open the song; with a set, only there.
 * - TEAM: the team's members, wherever they open the song.
 * - SONGBOOK: everyone who sees the songbook, while the song is in it.
 * - SET: those who open the set, only in that set.
 * - SONG: everyone who sees the song; written by its editors.
 *
 * Its author, and the place's moderators (a team's admins, a songbook's
 * editors, a set's leaders, the song's editors, global admins) edit,
 * resolve and delete it, and its replies. Anyone who sees it may reply.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccessPolicyService,
    private readonly sets: SetlistAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The notes the viewer sees on a song, opened in a set or a songbook (or neither), and where a new one may go. */
  async list(user: AuthenticatedUser, songVersionId: string, context: { setlistId?: string; songbookId?: string }): Promise<SongNotes> {
    const { song, set } = await this.reach(user, songVersionId, context.setlistId);
    const rows = await this.prisma.client.note.findMany({
      where: await this.visibleWhere(user, songVersionId, set?.set.id ?? null),
      include: NOTE_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    const document = readSongDocument(song.documentJson);
    const moderates = this.moderator(user, song);
    const moderatesReplies = this.moderator(user, song, { author: false });
    const notes: SongNote[] = [];
    for (const row of rows) notes.push(this.view(row, document, await moderates(row), user.id, await moderatesReplies(row)));
    return { notes, places: await this.places(user, song, set, context.songbookId) };
  }

  async create(user: AuthenticatedUser, dto: CreateNoteDto): Promise<SongNote> {
    const { song, at } = await this.placeFor(user, dto.songVersionId, dto);
    const row = await this.prisma.client.note.create({
      data: {
        ...at,
        content: dto.content,
        anchor: this.pinned(song, dto.anchor ?? { kind: "song" }),
        songVersionId: song.id,
        authorUserId: user.id,
      },
      include: NOTE_INCLUDE,
    });
    await announceNotes(song.id);
    return this.view(row, readSongDocument(song.documentJson), true, user.id);
  }

  async update(user: AuthenticatedUser, noteId: string, dto: UpdateNoteDto): Promise<SongNote> {
    const { row, song } = await this.editable(user, noteId);
    // Moved somewhere else (issue #262): who sees it is the author's to choose, not a moderator's; checked as a new note's place is.
    let at: NotePlacement | null = null;
    if (dto.place !== undefined) {
      if (row.authorUserId !== user.id) throw new ForbiddenException("Only the note's author can move it somewhere else");
      at = (await this.placeFor(user, row.songVersionId, { place: dto.place, teamId: dto.teamId, songbookId: dto.songbookId, setlistId: dto.setlistId })).at;
    }
    const updated = await this.prisma.client.note.update({
      where: { id: row.id },
      data: {
        ...at,
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.anchor !== undefined && { anchor: this.pinned(song, dto.anchor) }),
        ...(dto.resolved !== undefined && { resolvedAt: dto.resolved ? (row.resolvedAt ?? new Date()) : null }),
      },
      include: NOTE_INCLUDE,
    });
    await announceNotes(song.id);
    return this.view(updated, readSongDocument(song.documentJson), true, user.id, await this.moderator(user, song, { author: false })(updated));
  }

  /**
   * Where a note may be saved by `user` on a song, as its row has it: a team
   * they're in, a songbook or set the song is in (and they see), the song
   * itself for its editors; just them, everywhere or in one of its sets.
   */
  private async placeFor(user: AuthenticatedUser, songVersionId: string, dto: { place: NotePlace; teamId?: string | null; songbookId?: string | null; setlistId?: string | null }): Promise<{ song: SongForNotes; at: NotePlacement }> {
    const place = dto.place;
    const setlistId = place === "SET" || place === "ME" ? (dto.setlistId ?? undefined) : undefined;
    const { song, set } = await this.reach(user, songVersionId, setlistId, place === "SET" || place === "ME");
    if (setlistId && !set?.itemId) throw new BadRequestException(["setlistId must be a set the song is in"]);
    if (place === "TEAM") {
      await this.policy.assertSongverseTeam(dto.teamId!);
      if (!user.isGlobalAdmin && (await this.policy.teamRole(user.id, dto.teamId!)) === null) throw new ForbiddenException("Only the team's members can save notes in it");
    }
    if (place === "SONGBOOK") {
      const songbook = await this.prisma.client.songbook.findFirst({
        where: { AND: [{ id: dto.songbookId! }, await this.policy.songbooksVisibleTo(user)] },
        select: { entries: { where: { songVersionId: song.id }, select: { id: true } } },
      });
      if (!songbook) throw new NotFoundException("Songbook not found");
      if (songbook.entries.length === 0) throw new BadRequestException(["songbookId must be a songbook the song is in"]);
    }
    if (place === "SONG" && !(await this.policy.canEditContent(user, song))) throw new ForbiddenException("Only the song's editors can save notes in the song itself");
    return {
      song,
      at: {
        place,
        teamId: place === "TEAM" ? dto.teamId! : null,
        songbookId: place === "SONGBOOK" ? dto.songbookId! : null,
        setlistId: setlistId ?? null,
      },
    };
  }

  async remove(user: AuthenticatedUser, noteId: string): Promise<void> {
    const { row } = await this.editable(user, noteId);
    await this.prisma.client.note.delete({ where: { id: row.id } });
    await announceNotes(row.songVersionId);
  }

  /** A reply: anyone who sees the note. Its author and those in the thread are told (issue #149). */
  async reply(user: AuthenticatedUser, noteId: string, content: string): Promise<SongNote> {
    const { row, song } = await this.readable(user, noteId);
    await this.prisma.client.noteReply.create({ data: { noteId: row.id, authorUserId: user.id, content } });
    await announceNotes(song.id);
    const told = new Set([row.authorUserId, ...row.replies.map((reply) => reply.authorUserId)]);
    told.delete(user.id);
    const by = (await this.prisma.client.user.findUnique({ where: { id: user.id }, select: { displayName: true } }))?.displayName ?? "";
    const url = await this.noteUrl(row);
    const preview = content.length > 140 ? `${content.slice(0, 139)}…` : content;
    await this.notifications.notify([...told].map((userId) => ({ userId, kind: "NOTE_REPLY" as const, data: { by, song: song.title, note: preview }, url })));
    return this.fresh(user, row.id, song);
  }

  async updateReply(user: AuthenticatedUser, noteId: string, replyId: string, content: string): Promise<SongNote> {
    const { row, song } = await this.replyEditable(user, noteId, replyId);
    await this.prisma.client.noteReply.update({ where: { id: replyId }, data: { content } });
    await announceNotes(song.id);
    return this.fresh(user, row.id, song);
  }

  async removeReply(user: AuthenticatedUser, noteId: string, replyId: string): Promise<SongNote> {
    const { row, song } = await this.replyEditable(user, noteId, replyId);
    await this.prisma.client.noteReply.delete({ where: { id: replyId } });
    await announceNotes(song.id);
    return this.fresh(user, row.id, song);
  }

  /**
   * Whether a device may hear when a song's notes change (issue #27): the
   * viewer can open the song, in their library or through the set it's
   * opened in. The signal carries nothing - each device reads the notes
   * again with its own rights - but who's told is still who could look.
   */
  async canWatch(user: AuthenticatedUser, songVersionId: string, setlistId?: string): Promise<boolean> {
    return this.reach(user, songVersionId, setlistId).then(
      () => true,
      () => false,
    );
  }

  // --- Who sees what

  /**
   * The song, if the viewer can open it: in their library, or through the
   * set it's opened in (a guest reads the set's songs). 404 otherwise.
   */
  private async reach(user: AuthenticatedUser, songVersionId: string, setlistId: string | undefined, throughSet = true): Promise<{ song: SongForNotes; set: SetContext | null }> {
    const song = await this.prisma.client.songVersion.findUnique({
      where: { id: songVersionId },
      select: { id: true, title: true, ownerScope: true, ownerUserId: true, ownerTeamId: true, publicationState: true, documentJson: true },
    });
    if (!song) throw new NotFoundException("Song version not found");
    let set: SetContext | null = null;
    let readableThere = false;
    if (setlistId) {
      const { set: row, access } = await this.sets.findViewable(user, setlistId);
      const items = await this.prisma.client.setlistItem.findMany({
        where: { setlistId, songVersionId },
        orderBy: { position: "asc" },
        select: { id: true, sharedByUserId: true, songVersion: { select: SONG_SELECT } },
      });
      readableThere = items.length > 0 && (await this.sets.readableItems(row, items)).size > 0;
      set = { set: row, canEdit: access.canEdit, itemId: items[0]?.id ?? null };
    }
    if (!(await this.policy.canSeeSong(user, song)) && !(throughSet && readableThere)) throw new NotFoundException("Song version not found");
    return { song, set };
  }

  /** The notes on a song the viewer sees, opened in `setlistId` (or not). */
  private async visibleWhere(user: AuthenticatedUser, songVersionId: string, setlistId: string | null): Promise<Prisma.NoteWhereInput> {
    const [teamIds, songbooks] = await Promise.all([this.policy.teamIds(user.id), this.policy.songbooksVisibleTo(user)]);
    return {
      songVersionId,
      OR: [
        { place: "ME", authorUserId: user.id, OR: [{ setlistId: null }, ...(setlistId ? [{ setlistId }] : [])] },
        { place: "TEAM", teamId: { in: teamIds } },
        // While the song is in the songbook: taken out, its notes are hidden but kept.
        { place: "SONGBOOK", songbook: { AND: [songbooks, { entries: { some: { songVersionId } } }] } },
        ...(setlistId ? [{ place: "SET" as const, setlistId }] : []),
        { place: "SONG" },
      ],
    };
  }

  /** The note, if the viewer sees it somewhere (the set it's in, for a set's note); 404 otherwise. */
  private async readable(user: AuthenticatedUser, noteId: string): Promise<{ row: NoteRow; song: SongForNotes }> {
    const found = await this.prisma.client.note.findUnique({ where: { id: noteId }, select: { songVersionId: true, setlistId: true } });
    if (!found) throw new NotFoundException("Note not found");
    const { song, set } = await this.reach(user, found.songVersionId, found.setlistId ?? undefined).catch(() => {
      throw new NotFoundException("Note not found");
    });
    const row = await this.prisma.client.note.findFirst({ where: { AND: [{ id: noteId }, await this.visibleWhere(user, song.id, set?.set.id ?? null)] }, include: NOTE_INCLUDE });
    if (!row) throw new NotFoundException("Note not found");
    return { row, song };
  }

  /** The note, if the viewer may change it: its author or a moderator of its place. */
  private async editable(user: AuthenticatedUser, noteId: string): Promise<{ row: NoteRow; song: SongForNotes }> {
    const { row, song } = await this.readable(user, noteId);
    if (!(await this.moderator(user, song)(row))) throw new ForbiddenException("Only the note's author or its moderators can change it");
    return { row, song };
  }

  private async replyEditable(user: AuthenticatedUser, noteId: string, replyId: string): Promise<{ row: NoteRow; song: SongForNotes }> {
    const { row, song } = await this.readable(user, noteId);
    const reply = row.replies.find((one) => one.id === replyId);
    if (!reply) throw new NotFoundException("Reply not found");
    if (reply.authorUserId !== user.id && !(await this.moderator(user, song, { author: false })(row))) throw new ForbiddenException("Only the reply's author or the note's moderators can change it");
    return { row, song };
  }

  /**
   * Whether the viewer may change a note on `song`: its author, or its
   * place's moderators (answers kept per place). Someone's reply: its
   * author or the moderators, not the note's author (`author: false`).
   */
  private moderator(user: AuthenticatedUser, song: SongForNotes, { author = true } = {}): (row: NoteRow) => Promise<boolean> {
    const known = new Map<string, Promise<boolean>>();
    const once = (key: string, decide: () => Promise<boolean>) => {
      if (!known.has(key)) known.set(key, decide());
      return known.get(key)!;
    };
    return async (row) => {
      if ((author && row.authorUserId === user.id) || user.isGlobalAdmin) return true;
      switch (row.place) {
        case "TEAM":
          return once(`team:${row.teamId}`, async () => (await this.policy.teamRole(user.id, row.teamId!)) === "ADMIN");
        case "SONGBOOK":
          return once(`songbook:${row.songbookId}`, () => this.policy.canEdit(user, row.songbook!));
        case "SET":
          return once(`set:${row.setlistId}`, async () => (await this.sets.access(user, row.setlist!)).canEdit);
        case "SONG":
          return once("song", () => this.policy.canEditContent(user, song));
        default:
          return false;
      }
    };
  }

  /** Where the viewer may save a new note; the first is where they came from (a set, a songbook), else just them. */
  private async places(user: AuthenticatedUser, song: SongForNotes, set: SetContext | null, songbookId: string | undefined): Promise<NotePlaceChoice[]> {
    const [memberships, songbooks, editsSong] = await Promise.all([
      this.prisma.client.teamMembership.findMany({ where: { userId: user.id, team: { usesSongverse: true } }, select: { team: { select: { id: true, name: true } } }, orderBy: { team: { name: "asc" } } }),
      this.prisma.client.songbook.findMany({
        where: { AND: [await this.policy.songbooksVisibleTo(user), { entries: { some: { songVersionId: song.id } } }] },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.policy.canEditContent(user, song),
    ]);
    const me: NotePlaceChoice = { place: "ME", id: null, name: null };
    const inSet: NotePlaceChoice[] = [];
    if (set?.itemId) {
      const row = await this.prisma.client.setlist.findUnique({ where: { id: set.set.id }, select: { name: true, eventDate: true } });
      inSet.push({ place: "SET", id: set.set.id, name: setName(row) });
    }
    const books: NotePlaceChoice[] = songbooks.map((book) => ({ place: "SONGBOOK", id: book.id, name: book.name }));
    const opened = books.findIndex((book) => book.id === songbookId);
    const first = inSet.length > 0 ? inSet : opened >= 0 ? books.splice(opened, 1) : [];
    const rest = inSet.length > 0 ? [me] : [me, ...inSet];
    return [
      ...first,
      ...rest,
      ...memberships.map(({ team }): NotePlaceChoice => ({ place: "TEAM", id: team.id, name: team.name })),
      ...books,
      ...(editsSong ? [{ place: "SONG" as const, id: null, name: null }] : []),
    ];
  }

  // --- Views

  /** An anchor as the song is now: what it's pinned to, moved up when that's gone. */
  private pinned(song: SongForNotes, anchor: NoteAnchor): NoteAnchor {
    return resolveNoteAnchor(readSongDocument(song.documentJson), anchor).anchor;
  }

  private view(row: NoteRow, document: SongDocumentV2, canEdit: boolean, viewerId: string, canEditReplies = false): SongNote {
    const parsed = NoteAnchorSchema.safeParse(row.anchor);
    const resolved = parsed.success ? resolveNoteAnchor(document, parsed.data) : { anchor: { kind: "song" as const }, moved: true };
    const placeName = row.place === "TEAM" ? (row.team?.name ?? null) : row.place === "SONGBOOK" ? (row.songbook?.name ?? null) : row.setlist ? setName(row.setlist) : null;
    return {
      id: row.id,
      songVersionId: row.songVersionId,
      content: row.content,
      place: row.place,
      placeId: row.teamId ?? row.songbookId ?? row.setlistId,
      placeName,
      anchor: resolved.anchor,
      moved: resolved.moved,
      author: row.author,
      resolved: row.resolvedAt !== null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      replies: row.replies.map((reply) => ({
        id: reply.id,
        content: reply.content,
        author: reply.author,
        createdAt: reply.createdAt.toISOString(),
        updatedAt: reply.updatedAt.toISOString(),
        canEdit: canEditReplies || reply.authorUserId === viewerId,
      })),
      canEdit,
      canReply: true,
    };
  }

  /** The note again, as the viewer now sees it. */
  private async fresh(user: AuthenticatedUser, noteId: string, song: SongForNotes): Promise<SongNote> {
    const row = await this.prisma.client.note.findUniqueOrThrow({ where: { id: noteId }, include: NOTE_INCLUDE });
    return this.view(row, readSongDocument(song.documentJson), await this.moderator(user, song)(row), user.id, await this.moderator(user, song, { author: false })(row));
  }

  /** Where a notification takes one: the song in its set for a set's note, else the song. */
  private async noteUrl(row: NoteRow): Promise<string> {
    if (row.setlistId) {
      const item = await this.prisma.client.setlistItem.findFirst({ where: { setlistId: row.setlistId, songVersionId: row.songVersionId }, orderBy: { position: "asc" }, select: { id: true } });
      if (item) return `/sets/${row.setlistId}/songs/${item.id}?note=${row.id}`;
    }
    return `/library/${row.songVersionId}?note=${row.id}`;
  }
}

/** Where a song's notes changing is announced (issue #27), to every API instance: SyncServer tells the devices watching it. */
export const NOTES_CHANNEL = "songverse:notes:changed";

/** Tells the devices watching a song that its notes changed. A Redis that's down mustn't fail the write. */
export async function announceNotes(songVersionId: string): Promise<void> {
  await redis()
    .publish(NOTES_CHANNEL, songVersionId)
    .catch(() => undefined);
}

/** A set's name, or its date when it has none. */
function setName(set: { name: string | null; eventDate: Date | null } | null): string | null {
  return set?.name ?? set?.eventDate?.toISOString().slice(0, 10) ?? null;
}
