import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { foldForSearch } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import { AccessPolicyService, OPEN_SUBMISSION_STATES } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SongFoldService } from "./song-fold.service.js";

type Tx = Prisma.TransactionClient;
type SubmissionState = "SUBMITTED" | "UNDER_REVIEW" | "NEEDS_CHANGES" | "APPROVED" | "REJECTED" | "WITHDRAWN";

/** A global song that looks like the one being published. */
export interface CatalogueMatch {
  id: string;
  title: string;
  versionName: string | null;
  language: string;
  artists: string[];
  /** Why it matched: same title and an artist in common, same title only, or the same CCLI number. */
  reason: "titleAndArtist" | "title" | "ccli";
}

const SONG_SUMMARY = {
  id: true,
  title: true,
  versionName: true,
  language: true,
  ownerScope: true,
  ownerUserId: true,
  ownerTeamId: true,
  ownerTeam: { select: { name: true } },
  contributors: { where: { roles: { has: "PERFORMER" } }, select: { source: true }, orderBy: { displayOrder: "asc" } },
} satisfies Prisma.SongVersionSelect;

const SUBMISSION_SELECT = {
  id: true,
  state: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
  submitterMessage: true,
  duplicateReason: true,
  reviewNotes: true,
  similarityResults: true,
  mergeTargetId: true,
  publishedVersionId: true,
  submitter: { select: { id: true, displayName: true, email: true } },
  reviewer: { select: { id: true, displayName: true } },
  songVersion: { select: SONG_SUMMARY },
  publishedVersion: { select: { id: true, title: true } },
} satisfies Prisma.SubmissionSelect;

type SubmissionRow = Prisma.SubmissionGetPayload<{ select: typeof SUBMISSION_SELECT }>;

function toSubmission({ songVersion, similarityResults, ...rest }: SubmissionRow) {
  const { contributors, ownerTeam, ...song } = songVersion;
  return {
    ...rest,
    matches: (similarityResults ?? []) as unknown as CatalogueMatch[],
    song: { ...song, teamName: ownerTeam?.name ?? null, artists: contributors.map((c) => c.source ?? "") },
  };
}

const fold = (text: string) => foldForSearch(text).trim().replace(/\s+/g, " ");

/**
 * Putting personal and team songs into the global catalogue.
 *
 * Anyone who can edit a song can submit it; reviewers (and global admins)
 * approve it, send it back for changes, reject it, or merge it into a
 * global song it duplicates. Approving moves the song itself into the
 * catalogue (issue #73), as handing it to a team does: one song, with its
 * history, files, arrangements and notes, crediting who contributed it.
 * What was personal stays so (see promoteToGlobal). Merging folds the
 * submitter's song into the catalogue one (SongFoldService, #75): one
 * song, their way of singing it becoming their arrangement of it. Global
 * admins can also publish a song straight away - only when they choose
 * to, never automatically. Copyright and CCLI details aren't required.
 */
@Injectable()
export class PublishingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly folds: SongFoldService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Who submitted it told how it went (issue #149): published, or sent back with the reviewer's notes. */
  private async tellSubmitter(user: AuthenticatedUser, submissionId: string) {
    const row = await this.prisma.client.submission.findUnique({
      where: { id: submissionId },
      select: { state: true, submitterId: true, reviewNotes: true, songVersionId: true, publishedVersionId: true, songVersion: { select: { title: true } }, publishedVersion: { select: { title: true } }, reviewer: { select: { displayName: true } } },
    });
    if (!row) return;
    const published = row.state === "APPROVED";
    const songId = published ? (row.publishedVersionId ?? row.songVersionId) : row.songVersionId;
    await this.notifications.notify(
      [
        {
          userId: row.submitterId,
          kind: published ? "SUBMISSION_PUBLISHED" : "SUBMISSION_RETURNED",
          data: { by: row.reviewer?.displayName ?? "", song: row.publishedVersion?.title ?? row.songVersion?.title ?? "", ...(row.reviewNotes ? { note: row.reviewNotes } : {}) },
          url: `/library/${songId}`,
        },
      ],
      user.id,
    );
  }

  /** What the song page shows: the latest submission, the global song it's linked to, and look-alikes. */
  async status(user: AuthenticatedUser, songVersionId: string) {
    const song = await this.editableSong(user, songVersionId);
    const [latest, merged, matches] = await Promise.all([
      this.prisma.client.submission.findFirst({
        where: { songVersionId },
        orderBy: { createdAt: "desc" },
        select: SUBMISSION_SELECT,
      }),
      this.mergedInto(songVersionId),
      song.ownerScope === "GLOBAL" ? Promise.resolve([]) : this.findMatches(songVersionId),
    ]);
    const published = merged;
    return {
      submission: latest ? toSubmission(latest) : null,
      published,
      matches,
      canSubmit: song.ownerScope !== "GLOBAL" && !published && !(latest && isOpen(latest.state)),
      canPublishDirectly: user.isGlobalAdmin && song.ownerScope !== "GLOBAL" && !published && !(latest && isOpen(latest.state)),
    };
  }

  async submit(user: AuthenticatedUser, songVersionId: string, input: { message?: string; duplicateReason?: string }) {
    const matches = await this.assertPublishable(user, songVersionId, input.duplicateReason);
    const submission = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.submission.create({
        data: {
          songVersionId,
          submitterId: user.id,
          submitterMessage: input.message?.trim() || null,
          duplicateReason: matches.length ? input.duplicateReason!.trim() : null,
          similarityResults: matches as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await tx.songVersion.update({ where: { id: songVersionId }, data: { publicationState: "SUBMITTED" } });
      await audit(tx, "SUBMITTED", created.id, user.id, songVersionId);
      return created;
    });
    return this.findOneRow(submission.id);
  }

  /** A global admin puts their song in the catalogue without a review. */
  async publishDirectly(user: AuthenticatedUser, songVersionId: string, input: { duplicateReason?: string; trustLabel?: string }) {
    if (!user.isGlobalAdmin) throw new ForbiddenException("Only global admins can publish without a review");
    const matches = await this.assertPublishable(user, songVersionId, input.duplicateReason);
    const id = await this.prisma.client.$transaction(async (tx) => {
      const { id } = await tx.submission.create({
        data: {
          songVersionId,
          submitterId: user.id,
          reviewerId: user.id,
          duplicateReason: matches.length ? input.duplicateReason!.trim() : null,
          similarityResults: matches as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await this.approveIn(tx, user, id, songVersionId, { trustLabel: input.trustLabel });
      return id;
    });
    return this.findOneRow(id);
  }

  /** The submitter (or anyone who can edit the song) takes it back. */
  async withdraw(user: AuthenticatedUser, submissionId: string) {
    const submission = await this.ownSubmission(user, submissionId);
    if (!isOpen(submission.state)) throw new ConflictException("This submission is no longer open");
    await this.prisma.client.$transaction(async (tx) => {
      await tx.submission.update({ where: { id: submissionId }, data: { state: "WITHDRAWN" } });
      await tx.songVersion.update({ where: { id: submission.songVersionId }, data: { publicationState: "DRAFT" } });
      await audit(tx, "WITHDRAWN", submissionId, user.id, submission.songVersionId);
    });
    return this.findOneRow(submissionId);
  }

  /** Sends a song back for review after the changes a reviewer asked for. */
  async resubmit(user: AuthenticatedUser, submissionId: string, input: { message?: string }) {
    const submission = await this.ownSubmission(user, submissionId);
    if (submission.state !== "NEEDS_CHANGES") throw new ConflictException("Only a submission sent back for changes can be resubmitted");
    const matches = await this.findMatches(submission.songVersionId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: submissionId },
        data: {
          state: "SUBMITTED",
          ...(input.message?.trim() && { submitterMessage: input.message.trim() }),
          similarityResults: matches as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.songVersion.update({ where: { id: submission.songVersionId }, data: { publicationState: "SUBMITTED" } });
      await audit(tx, "SUBMITTED", submissionId, user.id, submission.songVersionId, { resubmitted: true });
    });
    return this.findOneRow(submissionId);
  }

  /** The review queue: open submissions, oldest first (or closed ones, newest first). */
  async list(user: AuthenticatedUser, filter: "open" | "closed") {
    assertReviewer(user);
    const rows = await this.prisma.client.submission.findMany({
      where: filter === "open" ? { state: { in: [...OPEN_SUBMISSION_STATES] } } : { state: { notIn: [...OPEN_SUBMISSION_STATES] } },
      orderBy: { createdAt: filter === "open" ? "asc" : "desc" },
      take: filter === "open" ? undefined : 100,
      select: SUBMISSION_SELECT,
    });
    return rows.map(toSubmission);
  }

  /** The user's own submissions, newest first. */
  async mine(user: AuthenticatedUser) {
    const rows = await this.prisma.client.submission.findMany({
      where: { submitterId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: SUBMISSION_SELECT,
    });
    return rows.map(toSubmission);
  }

  async findOne(user: AuthenticatedUser, submissionId: string) {
    const row = await this.findOneRow(submissionId);
    if (!isReviewer(user) && row.submitter.id !== user.id) {
      await this.editableSong(user, row.song.id);
    }
    return row;
  }

  async startReview(user: AuthenticatedUser, submissionId: string) {
    const submission = await this.reviewable(user, submissionId, ["SUBMITTED"]);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.submission.update({ where: { id: submissionId }, data: { state: "UNDER_REVIEW", reviewerId: user.id } });
      await tx.songVersion.update({ where: { id: submission.songVersionId }, data: { publicationState: "UNDER_REVIEW" } });
    });
    return this.findOneRow(submissionId);
  }

  async approve(user: AuthenticatedUser, submissionId: string, input: { notes?: string; trustLabel?: string }) {
    const submission = await this.reviewable(user, submissionId, ["SUBMITTED", "UNDER_REVIEW"]);
    await this.assertNotPublished(submission.songVersionId);
    await this.prisma.client.$transaction((tx) =>
      this.approveIn(tx, user, submissionId, submission.songVersionId, { notes: input.notes, trustLabel: input.trustLabel }),
    );
    await this.tellSubmitter(user, submissionId);
    return this.findOneRow(submissionId);
  }

  /**
   * The song is already in the catalogue: the submitter's song is folded
   * into that one (#75) - its arrangements, files, sets and the rest move
   * over, and how they had it becomes their arrangement of it - rather than
   * becoming a second catalogue song or staying a copy.
   */
  async merge(user: AuthenticatedUser, submissionId: string, input: { targetId: string; notes?: string }) {
    const submission = await this.reviewable(user, submissionId, ["SUBMITTED", "UNDER_REVIEW"]);
    await this.assertNotPublished(submission.songVersionId);
    const target = await this.prisma.client.songVersion.findUnique({
      where: { id: input.targetId },
      select: { ownerScope: true, publicationState: true },
    });
    if (!target || target.ownerScope !== "GLOBAL" || target.publicationState !== "APPROVED") {
      throw new BadRequestException("Merge into a song that's in the global catalogue");
    }
    await this.prisma.client.$transaction(
      async (tx) => {
        await tx.submission.update({
          where: { id: submissionId },
          data: {
            state: "APPROVED",
            reviewerId: user.id,
            reviewedAt: new Date(),
            reviewNotes: input.notes?.trim() || null,
            mergeTargetId: input.targetId,
            publishedVersionId: input.targetId,
          },
        });
        await audit(tx, "APPROVED", submissionId, user.id, submission.songVersionId, { mergedInto: input.targetId });
        // The submission moves with the song, to the catalogue one.
        await this.folds.fold(tx, submission.songVersionId, input.targetId, submission.submitterId);
      },
      { timeout: 60_000 },
    );
    await this.tellSubmitter(user, submissionId);
    return this.findOneRow(submissionId);
  }

  async requestChanges(user: AuthenticatedUser, submissionId: string, notes: string) {
    return this.close(user, submissionId, "NEEDS_CHANGES", notes);
  }

  async reject(user: AuthenticatedUser, submissionId: string, notes: string) {
    return this.close(user, submissionId, "REJECTED", notes);
  }

  private async close(user: AuthenticatedUser, submissionId: string, state: "NEEDS_CHANGES" | "REJECTED", notes: string) {
    if (!notes.trim()) throw new BadRequestException("Say what needs changing, or why it's rejected");
    const submission = await this.reviewable(user, submissionId, ["SUBMITTED", "UNDER_REVIEW"]);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: submissionId },
        data: { state, reviewerId: user.id, reviewedAt: new Date(), reviewNotes: notes.trim() },
      });
      await tx.songVersion.update({ where: { id: submission.songVersionId }, data: { publicationState: state } });
      await audit(tx, state === "REJECTED" ? "REJECTED" : "UPDATED", submissionId, user.id, submission.songVersionId, { state });
    });
    await this.tellSubmitter(user, submissionId);
    return this.findOneRow(submissionId);
  }

  /** Moves the song into the catalogue and closes the submission. */
  private async approveIn(tx: Tx, user: AuthenticatedUser, submissionId: string, songVersionId: string, input: { notes?: string; trustLabel?: string }) {
    const { submitterId } = await tx.submission.findUniqueOrThrow({ where: { id: submissionId }, select: { submitterId: true } });
    await promoteToGlobal(tx, songVersionId, input.trustLabel?.trim() || null, submitterId);
    await tx.submission.update({
      where: { id: submissionId },
      data: {
        state: "APPROVED",
        reviewerId: user.id,
        reviewedAt: new Date(),
        reviewNotes: input.notes?.trim() || null,
        publishedVersionId: songVersionId,
      },
    });
    await audit(tx, "APPROVED", submissionId, user.id, songVersionId);
    await tx.auditEvent.create({
      data: { action: "PROMOTED_TO_GLOBAL", entityType: "SongVersion", entityId: songVersionId, actorUserId: user.id, songVersionId, metadata: { submissionId } },
    });
  }

  /**
   * Global songs that look like this one: the same title or subtitle
   * (ignoring case and accents), or the same CCLI number.
   */
  async findMatches(songVersionId: string): Promise<CatalogueMatch[]> {
    const song = await this.prisma.client.songVersion.findUniqueOrThrow({
      where: { id: songVersionId },
      select: { title: true, alternateTitle: true, ccli: true, contributors: { where: { roles: { has: "PERFORMER" } }, select: { source: true } } },
    });
    const titles = [song.title, song.alternateTitle].filter((t): t is string => !!t?.trim());
    const candidates = await this.prisma.client.songVersion.findMany({
      where: {
        ownerScope: "GLOBAL",
        publicationState: "APPROVED",
        OR: [
          ...titles.flatMap((t) => [
            { title: { equals: t.trim(), mode: "insensitive" as const } },
            { alternateTitle: { equals: t.trim(), mode: "insensitive" as const } },
          ]),
          ...(song.ccli ? [{ ccli: song.ccli }] : []),
        ],
      },
      select: { ...SONG_SUMMARY, ccli: true },
      take: 20,
    });
    const artists = new Set(song.contributors.map((c) => fold(c.source ?? "")).filter(Boolean));
    return candidates.map((c) => {
      const theirArtists = c.contributors.map((a) => a.source ?? "");
      const sameCcli = !!song.ccli && c.ccli === song.ccli;
      const sharedArtist = theirArtists.some((a) => artists.has(fold(a)));
      return {
        id: c.id,
        title: c.title,
        versionName: c.versionName,
        language: c.language,
        artists: theirArtists,
        reason: sameCcli ? "ccli" : sharedArtist ? "titleAndArtist" : "title",
      } satisfies CatalogueMatch;
    });
  }

  /** The look-alikes, after checking the song can be put forward at all. */
  private async assertPublishable(user: AuthenticatedUser, songVersionId: string, duplicateReason: string | undefined) {
    const song = await this.editableSong(user, songVersionId);
    if (song.ownerScope === "GLOBAL") throw new BadRequestException("This song is already in the global catalogue");
    await this.assertNotPublished(songVersionId);
    const open = await this.prisma.client.submission.count({ where: { songVersionId, state: { in: [...OPEN_SUBMISSION_STATES] } } });
    if (open > 0) throw new ConflictException("This song is already waiting for review");
    const matches = await this.findMatches(songVersionId);
    if (matches.length > 0 && !duplicateReason?.trim()) {
      throw new ConflictException({
        message: "Similar songs are already in the global catalogue - say why this one should be added too",
        matches,
      });
    }
    return matches;
  }

  private async assertNotPublished(songVersionId: string) {
    const [song, merged] = await Promise.all([
      this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { ownerScope: true } }),
      this.mergedInto(songVersionId),
    ]);
    if (song?.ownerScope === "GLOBAL" || merged) throw new ConflictException("This song is already in the global catalogue");
  }

  /** The catalogue song an approved submission merged this one into, if any. */
  private async mergedInto(songVersionId: string) {
    const merged = await this.prisma.client.submission.findFirst({
      where: { songVersionId, state: "APPROVED", mergeTargetId: { not: null } },
      orderBy: { reviewedAt: "desc" },
      select: { publishedVersion: { select: { id: true, title: true } } },
    });
    return merged?.publishedVersion ?? null;
  }

  private async editableSong(user: AuthenticatedUser, songVersionId: string) {
    const song = await this.prisma.client.songVersion.findUnique({
      where: { id: songVersionId },
      select: { ownerScope: true, ownerUserId: true, ownerTeamId: true },
    });
    if (!song) throw new NotFoundException("Song version not found");
    await this.access.assertCanEdit(user, song, "song");
    return song;
  }

  /** A submission the user sent, or one for a song they can edit. */
  private async ownSubmission(user: AuthenticatedUser, submissionId: string) {
    const submission = await this.prisma.client.submission.findUnique({
      where: { id: submissionId },
      select: { state: true, songVersionId: true, submitterId: true },
    });
    if (!submission) throw new NotFoundException("Submission not found");
    if (submission.submitterId !== user.id) await this.editableSong(user, submission.songVersionId);
    return submission;
  }

  /** A submission in one of `states` that `user` may review (not their own, unless they're a global admin). */
  private async reviewable(user: AuthenticatedUser, submissionId: string, states: SubmissionState[]) {
    assertReviewer(user);
    const submission = await this.prisma.client.submission.findUnique({
      where: { id: submissionId },
      select: { state: true, songVersionId: true, submitterId: true },
    });
    if (!submission) throw new NotFoundException("Submission not found");
    if (submission.submitterId === user.id && !user.isGlobalAdmin) {
      throw new ForbiddenException("Someone else has to review your own submission");
    }
    if (!states.includes(submission.state)) throw new ConflictException(`This submission is ${submission.state.toLowerCase().replace("_", " ")}`);
    return submission;
  }

  private async findOneRow(submissionId: string) {
    const row = await this.prisma.client.submission.findUnique({ where: { id: submissionId }, select: SUBMISSION_SELECT });
    if (!row) throw new NotFoundException("Submission not found");
    return toSubmission(row);
  }
}

function isOpen(state: string): boolean {
  return (OPEN_SUBMISSION_STATES as readonly string[]).includes(state);
}

function isReviewer(user: AuthenticatedUser): boolean {
  return user.isGlobalAdmin || user.isReviewer;
}

function assertReviewer(user: AuthenticatedUser): void {
  if (!isReviewer(user)) throw new ForbiddenException("Reviewer role required");
}

function audit(
  tx: Tx,
  action: "SUBMITTED" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "UPDATED",
  submissionId: string,
  actorUserId: string,
  songVersionId: string,
  metadata?: Prisma.InputJsonObject,
) {
  return tx.auditEvent.create({
    data: { action, entityType: "Submission", entityId: submissionId, actorUserId, songVersionId, ...(metadata && { metadata }) },
  });
}

/**
 * Moves the song into the catalogue, in place (issue #73): same row, so its
 * history, files, arrangements, notes, sets and songbooks follow. Credited
 * to its owner (or, for a team's song, the team and who submitted it).
 *
 * What only its owner or team saw stays so: files everyone who could see
 * the song saw go to its owner only (a personal song) or its team, and
 * their uploaders decide from there (#72); personal and team tags stay,
 * shown only to their owners. A request to hand it to a team lapses.
 */
async function promoteToGlobal(tx: Tx, songVersionId: string, trustLabel: string | null, submitterId: string): Promise<void> {
  const song = await tx.songVersion.findUniqueOrThrow({
    where: { id: songVersionId },
    select: { ownerScope: true, ownerUserId: true, ownerTeamId: true },
  });
  if (song.ownerScope === "TEAM" && song.ownerTeamId) {
    await tx.attachment.updateMany({ where: { songVersionId, visibility: { in: ["SONG", "SHARED"] } }, data: { visibility: "TEAM", visibleToTeamId: song.ownerTeamId } });
  } else {
    await tx.attachment.updateMany({ where: { songVersionId, visibility: { in: ["SONG", "SHARED"] }, uploadedByUserId: null }, data: { uploadedByUserId: song.ownerUserId } });
    await tx.attachment.updateMany({ where: { songVersionId, visibility: { in: ["SONG", "SHARED"] } }, data: { visibility: "PRIVATE" } });
  }
  // Its reference recordings (issue #346) the same way.
  if (song.ownerScope === "TEAM" && song.ownerTeamId) {
    await tx.songLink.updateMany({ where: { songVersionId, visibility: { in: ["SONG", "SHARED"] } }, data: { visibility: "TEAM", visibleToTeamId: song.ownerTeamId } });
  } else {
    await tx.songLink.updateMany({ where: { songVersionId, visibility: { in: ["SONG", "SHARED"] }, addedByUserId: null }, data: { addedByUserId: song.ownerUserId } });
    await tx.songLink.updateMany({ where: { songVersionId, visibility: { in: ["SONG", "SHARED"] } }, data: { visibility: "PRIVATE" } });
  }
  await tx.songOwnershipRequest.updateMany({ where: { songVersionId, status: "PENDING" }, data: { status: "DECLINED", decidedAt: new Date() } });
  // Everyone sees it now: sharing it with someone (#77) means nothing more.
  await tx.accessGrant.deleteMany({ where: { songVersionId } });
  await tx.songVersion.update({
    where: { id: songVersionId },
    data: {
      ownerScope: "GLOBAL",
      ownerUserId: null,
      ownerTeamId: null,
      publicationState: "APPROVED",
      trustLabel,
      contributedByUserId: song.ownerScope === "USER" ? song.ownerUserId : submitterId,
      contributedByTeamId: song.ownerScope === "TEAM" ? song.ownerTeamId : null,
    },
  });
}

