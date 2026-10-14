import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { mergeSnapshots, snapshotChanges, type SongSnapshot } from "@songverse/core";
import type { Prisma } from "@songverse/db";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SongHistoryService } from "../song-versions/song-history.service.js";
import { SongVersionsService } from "../song-versions/song-versions.service.js";
import type { CreateSuggestionDto } from "./suggestions.dto.js";

/** What a suggestion stores: the song as it was when it was made, and as it would leave it. */
interface SuggestedChange {
  $schema: "song-change/v1";
  base: SongSnapshot;
  proposed: SongSnapshot;
}

const SELECT = {
  id: true,
  state: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
  description: true,
  reviewNotes: true,
  proposedChange: true,
  proposer: { select: { id: true, displayName: true } },
  reviewer: { select: { id: true, displayName: true } },
  songVersion: { select: { id: true, title: true, versionName: true, ownerScope: true } },
} satisfies Prisma.ChangeProposalSelect;

type Row = Prisma.ChangeProposalGetPayload<{ select: typeof SELECT }>;

const OPEN = ["OPEN", "UNDER_REVIEW"] as const;

function readChange(json: Prisma.JsonValue): SuggestedChange {
  const change = json as unknown as SuggestedChange | null;
  if (change?.$schema !== "song-change/v1") throw new Error("Not a song-change/v1");
  return change;
}

/** A suggestion in a list: who, which song, where it stands, what it changes. */
function summary({ proposedChange, songVersion, ...row }: Row) {
  const change = readChange(proposedChange);
  return { ...row, song: songVersion, changes: snapshotChanges(change.base, change.proposed) };
}

const isReviewer = (user: AuthenticatedUser) => user.isGlobalAdmin || user.isReviewer;

/**
 * Suggested changes to catalogue songs (issue #74). Only admins edit a
 * catalogue song; anyone who sees it, its contributor included, can
 * suggest a change - the chart, details or credits, made in the song
 * editor - which a reviewer accepts or declines. Accepting saves it as an
 * edit credited to who suggested it, on top of whatever changed since,
 * unless the same part was changed since too.
 */
@Injectable()
export class SuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly songs: SongVersionsService,
    private readonly history: SongHistoryService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(user: AuthenticatedUser, songVersionId: string, dto: CreateSuggestionDto) {
    await this.access.assertCanSeeSong(user, songVersionId);
    const song = await this.prisma.client.songVersion.findUniqueOrThrow({ where: { id: songVersionId }, select: { ownerScope: true } });
    if (song.ownerScope !== "GLOBAL") throw new BadRequestException("Suggestions are for songs in the global catalogue");
    const { message, ...update } = dto;
    const { before, after } = await this.songs.previewUpdate(user, songVersionId, update);
    const changes = snapshotChanges(before, after);
    if (changes.length === 0) throw new BadRequestException("That doesn't change anything");
    const change: SuggestedChange = { $schema: "song-change/v1", base: before, proposed: after };
    const row = await this.prisma.client.changeProposal.create({
      data: {
        songVersionId,
        proposerId: user.id,
        type: changes.length === 1 && changes[0] === "details" ? "METADATA_UPDATE" : "FULL_REVISION",
        title: after.details.title,
        description: message?.trim() || null,
        proposedChange: change as unknown as Prisma.InputJsonValue,
      },
      select: SELECT,
    });
    return summary(row);
  }

  /** Reviewers: the open ones, oldest first, or the closed ones, newest first. */
  async list(user: AuthenticatedUser, state: "open" | "closed") {
    if (!isReviewer(user)) throw new ForbiddenException("Reviewer role required");
    const rows = await this.prisma.client.changeProposal.findMany({
      where: { state: state === "open" ? { in: [...OPEN] } : { notIn: [...OPEN] } },
      orderBy: { createdAt: state === "open" ? "asc" : "desc" },
      take: state === "open" ? undefined : 100,
      select: SELECT,
    });
    return rows.map(summary);
  }

  /** The user's own, newest first; on one song when `songVersionId` is given. */
  async mine(user: AuthenticatedUser, songVersionId?: string) {
    const rows = await this.prisma.client.changeProposal.findMany({
      where: { proposerId: user.id, ...(songVersionId && { songVersionId }) },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: SELECT,
    });
    return rows.map(summary);
  }

  /**
   * One suggestion, for who made it or a reviewer: the song as it was and
   * as it would leave it, and - while it's open - the parts changed since
   * in the same place (`conflicts`), which stop it being accepted.
   */
  async findOne(user: AuthenticatedUser, id: string) {
    const row = await this.find(user, id);
    const change = readChange(row.proposedChange);
    const open = (OPEN as readonly string[]).includes(row.state);
    const current = open ? await this.current(row.songVersion.id) : null;
    return {
      ...summary(row),
      base: change.base,
      proposed: change.proposed,
      conflicts: current ? mergeSnapshots(change.base, change.proposed, current).conflicts : [],
    };
  }

  async accept(user: AuthenticatedUser, id: string, notes?: string) {
    const row = await this.reviewable(user, id);
    const change = readChange(row.proposedChange);
    const current = await this.current(row.songVersion.id);
    const { merged, conflicts } = mergeSnapshots(change.base, change.proposed, current);
    if (conflicts.length > 0) {
      throw new ConflictException({ message: "The song was changed in the same place since this was suggested", conflicts });
    }
    await this.songs.saveSnapshot(user, row.songVersion.id, merged, row.proposer.id, current);
    return this.close(user, id, "ACCEPTED", notes);
  }

  async decline(user: AuthenticatedUser, id: string, notes?: string) {
    if (!notes?.trim()) throw new BadRequestException("Say why it's declined");
    await this.reviewable(user, id);
    return this.close(user, id, "REJECTED", notes);
  }

  async withdraw(user: AuthenticatedUser, id: string) {
    const row = await this.find(user, id);
    if (row.proposer.id !== user.id) throw new ForbiddenException("Only who suggested it can withdraw it");
    if (!(OPEN as readonly string[]).includes(row.state)) throw new ConflictException("This suggestion is no longer open");
    const updated = await this.prisma.client.changeProposal.update({ where: { id }, data: { state: "WITHDRAWN" }, select: SELECT });
    return summary(updated);
  }

  private async close(user: AuthenticatedUser, id: string, state: "ACCEPTED" | "REJECTED", notes?: string) {
    const updated = await this.prisma.client.changeProposal.update({
      where: { id },
      data: { state, reviewerId: user.id, reviewedAt: new Date(), reviewNotes: notes?.trim() || null },
      select: SELECT,
    });
    // Who suggested it told (issue #149).
    await this.notifications.notify(
      [
        {
          userId: updated.proposer.id,
          kind: state === "ACCEPTED" ? "SUGGESTION_ACCEPTED" : "SUGGESTION_DECLINED",
          data: { by: updated.reviewer?.displayName ?? "", song: updated.songVersion.title, ...(updated.reviewNotes ? { note: updated.reviewNotes } : {}) },
          url: `/library/${updated.songVersion.id}`,
        },
      ],
      user.id,
    );
    return summary(updated);
  }

  private async current(songVersionId: string): Promise<SongSnapshot> {
    const now = await this.history.before(this.prisma.client, songVersionId);
    if (!now) throw new NotFoundException("Song version not found");
    return now.snapshot;
  }

  private async find(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.client.changeProposal.findUnique({ where: { id }, select: SELECT });
    if (!row || (row.proposer.id !== user.id && !isReviewer(user))) throw new NotFoundException("Suggestion not found");
    return row;
  }

  /** An open suggestion `user` may review: not their own, unless they're a global admin. */
  private async reviewable(user: AuthenticatedUser, id: string) {
    if (!isReviewer(user)) throw new ForbiddenException("Reviewer role required");
    const row = await this.find(user, id);
    if (row.proposer.id === user.id && !user.isGlobalAdmin) throw new ForbiddenException("Someone else has to review your own suggestion");
    if (!(OPEN as readonly string[]).includes(row.state)) throw new ConflictException("This suggestion is no longer open");
    return row;
  }
}
