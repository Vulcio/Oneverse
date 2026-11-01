import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnsupportedMediaTypeException } from "@nestjs/common";
import type { Queue } from "bullmq";
import { parseKey, type StemPart } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { AccessPolicyService, type Viewer } from "../access/access-policy.service.js";
import type { AttachmentVisibilityValue, UpdateAttachmentDto } from "./dto/upload-attachment.dto.js";
import { ImageService, type ProcessedImage } from "../images/image.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageQuotaService } from "../storage/storage-quota.service.js";
import { StorageService } from "../storage/storage.service.js";
import { RECORDINGS_QUEUE } from "../jobs/jobs.constants.js";
import { audioRights } from "../roles/audio-rights.js";
import { MAX_UPLOAD_BITRATE } from "../recordings/ffmpeg.js";
import type { ProcessTakeJob, ShrinkUploadJob } from "../recordings/recordings.processor.js";
import type { AttachmentTypeValue } from "./dto/upload-attachment.dto.js";

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
    private readonly images: ImageService,
    private readonly access: AccessPolicyService,
    @InjectQueue(RECORDINGS_QUEUE) private readonly recordings: Queue<ProcessTakeJob | ShrinkUploadJob>,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * A part recorded into a multitrack of someone's song (issue #149): its
   * owner - a team song's admins - told; once an hour at most for the same
   * person and song, while the last one is unread.
   */
  private async tellRecorded(viewer: Viewer, songVersionId: string, part: string | null) {
    const song = await this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { title: true, ownerUserId: true, ownerTeamId: true } });
    if (!song) return;
    const owners = song.ownerTeamId
      ? (await this.prisma.client.teamMembership.findMany({ where: { teamId: song.ownerTeamId, role: "ADMIN" }, select: { userId: true } })).map((row) => row.userId)
      : song.ownerUserId
        ? [song.ownerUserId]
        : [];
    const me = await this.prisma.client.user.findUnique({ where: { id: viewer.id }, select: { displayName: true } });
    const url = `/library/${songVersionId}`;
    const recent = await this.prisma.client.notification.findMany({
      where: { userId: { in: owners }, kind: "PART_RECORDED", url, readAt: null, createdAt: { gte: new Date(Date.now() - 3_600_000) }, data: { path: ["by"], equals: me?.displayName ?? "" } },
      select: { userId: true },
    });
    const told = new Set(recent.map((row) => row.userId));
    await this.notifications.notify(
      owners.filter((userId) => !told.has(userId)).map((userId) => ({ userId, kind: "PART_RECORDED" as const, data: { by: me?.displayName ?? "", song: song.title, ...(part ? { partName: part } : {}) }, url })),
      viewer.id,
    );
  }

  /**
   * The files `viewer` sees (issue #72): their own, the song's (SONG),
   * their teams' (TEAM), and those for the people the song is shared with
   * when it's shared with them or their teams (SHARED, #79, #331); a global admin sees them all. Seeing the song
   * itself is checked separately.
   */
  static visibleWhere(viewer: Viewer, teamIds: string[]): Prisma.AttachmentWhereInput {
    if (viewer.isGlobalAdmin) return {};
    return {
      OR: [
        { visibility: "SONG" },
        { uploadedByUserId: viewer.id },
        { visibility: "TEAM", visibleToTeamId: { in: teamIds } },
        { visibility: "SHARED", songVersion: { accessGrants: { some: { OR: [{ grantedToUserId: viewer.id }, { grantedToTeamId: { in: teamIds } }, { grantedToOrganization: { memberships: { some: { userId: viewer.id } } } }] } } } },
      ],
    };
  }

  /** The song's files the viewer sees, newest first, with what they may do with each. */
  async listForSongVersion(viewer: Viewer, songVersionId: string) {
    const [teamIds, canEditSong] = await Promise.all([this.access.teamIds(viewer.id), this.canEditSong(viewer, songVersionId)]);
    const rows = await this.prisma.client.attachment.findMany({
      where: { songVersionId, ...AttachmentsService.visibleWhere(viewer, teamIds) },
      include: ATTACHMENT_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => present(row, viewer, canEditSong));
  }

  /**
   * listForSongVersion for many songs at once (issue #122), in one query:
   * `canEditSong` says, for each song, whether the viewer manages it.
   */
  async listForSongVersions(viewer: Viewer, songs: { id: string; canEditSong: boolean }[]) {
    const teamIds = await this.access.teamIds(viewer.id);
    const rows = await this.prisma.client.attachment.findMany({
      where: { songVersionId: { in: songs.map((song) => song.id) }, ...AttachmentsService.visibleWhere(viewer, teamIds) },
      include: ATTACHMENT_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    const bySong = new Map(songs.map((song) => [song.id, [] as ReturnType<typeof present>[]]));
    const canEdit = new Map(songs.map((song) => [song.id, song.canEditSong]));
    for (const row of rows) bySong.get(row.songVersionId)?.push(present(row, viewer, canEdit.get(row.songVersionId) ?? false));
    return bySong;
  }

  /**
   * A file on the song, for its uploader. Anyone who can see the song may
   * add their own (PRIVATE, or for a team of theirs); only who manages
   * the song may show one to everyone who sees it (SONG) or to the people
   * it's shared with (SHARED).
   */
  async upload(
    viewer: Viewer,
    songVersionId: string,
    type: AttachmentTypeValue,
    filename: string,
    mimeType: string,
    body: Buffer,
    stemPart: StemPart | null = null,
    visibility: AttachmentVisibilityValue = "PRIVATE",
    teamId: string | null = null,
    recording: RecordingChange = {},
    take: { process?: string; otherTake?: boolean; partName?: string } = {},
  ) {
    if (stemPart && type !== "AUDIO") throw new BadRequestException("Only audio files can be stems");
    // Uploading audio files is a role's (issue #183); what's recorded in Songverse (a take it processes) isn't.
    if (type === "AUDIO" && !take.process && !viewer.isGlobalAdmin && !(await audioRights(this.prisma.client, this.storage, viewer.id, songVersionId)).canUploadAudio) {
      throw new ForbiddenException("Uploading audio files needs a role that allows it: ask an admin. You can still record in Songverse");
    }
    const details = recordingData(recording);
    if (type !== "AUDIO" && (Object.values(details).some((value) => value !== null) || take.otherTake || take.process)) {
      throw new BadRequestException("Only audio files can have a recording's key and tempo or be part of a multitrack");
    }
    // A recorded take to turn into Opus (issue #127): the browser's WAV.
    const steps = take.process?.split(",") ?? [];
    if (take.process && !WAV_TYPES.has(mimeType)) throw new BadRequestException("Only a WAV file can be processed");
    if (details.multitrackSetlistId) await this.assertSetOfSong(viewer, details.multitrackSetlistId, songVersionId);
    const song = await this.songRights(viewer, songVersionId);
    const canEditSong = song.canEditSong;
    const audience = await this.audience(viewer, song, visibility, teamId);
    // In its organisation's own bucket (issue #206), its admins' limits there, not the server's pools.
    const location = await this.storage.locationForSong(songVersionId);
    if (location) await this.quota.assertCanStoreInOrganization(location, viewer.id, body.length, songVersionId);
    else await this.quota.assertCanStore(viewer.id, body.length, songVersionId);
    const { hash, sizeBytes } = await this.storage.put(body, mimeType, location);
    // Made Opus by the Worker above 320 kbps (issue #182): a WAV says its rate in its header, so it's known now;
    // a FLAC or AIFF always is, for music; anything else, the Worker finds out (null: maybe).
    const shrinks = type !== "AUDIO" || take.process ? false : wavBitrate(body) !== null ? wavBitrate(body)! > MAX_UPLOAD_BITRATE : LOSSLESS_TYPES.has(mimeType) ? true : null;
    const row = await this.prisma.client.attachment.create({
      data: {
        songVersionId,
        type,
        filename,
        mimeType,
        storageKey: hash,
        storedInOrganizationId: location,
        sizeBytes,
        uploadedByUserId: viewer.id,
        stemPart,
        ...details,
        ...audience,
        otherTake: take.otherTake ?? false,
        partName: type === "AUDIO" ? take.partName || null : null,
        // A WAV, FLAC or AIFF upload is made Opus (issue #182): it says so meanwhile.
        processing: take.process || shrinks === true ? "PENDING" : null,
        // Recorded in Songverse's recorder (issue #175): a take it processes.
        origin: take.process ? "RECORDED" : "UPLOADED",
        // Audio uploaded as it is among the song's own files - its original stems, or its recording -
        // kept so until unlocked (issue #145); a recording, or a file added to a multitrack, isn't.
        locked: type === "AUDIO" && !take.process && !take.otherTake && !details.multitrackId,
      },
      include: ATTACHMENT_INCLUDE,
    });
    if (take.process && details.multitrackId) await this.tellRecorded(viewer, songVersionId, take.partName || null);
    if (take.process) {
      await this.recordings.add(
        "process-take",
        { attachmentId: row.id, filename, voice: steps.includes("voice"), level: steps.includes("level"), noise: steps.includes("noise"), quietFor: row.recordingFirstBeat },
        { attempts: 2, backoff: { type: "exponential", delay: 10000 }, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } },
      );
    }
    // Above 320 kbps, an upload is made Opus by the Worker (issue #182); it checks.
    if (shrinks !== false) {
      // A lossless original kept beside it for who may (a role, issue #182).
      const keepOriginal = viewer.isGlobalAdmin || (await audioRights(this.prisma.client, this.storage, viewer.id, songVersionId)).canKeepLosslessAudio;
      await this.recordings.add("shrink-upload", { attachmentId: row.id, filename, keepOriginal }, { attempts: 2, backoff: { type: "exponential", delay: 10000 }, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } });
    }
    return present(row, viewer, canEditSong);
  }

  /**
   * Cleans up an audio file afterwards (issue #132): the Worker runs the
   * steps on it - RNNoise on a voice, the level evened out, steady noise
   * reduced - and it comes back as Opus, a new file in its place.
   */
  async process(viewer: Viewer, songVersionId: string, attachmentId: string, steps: ("voice" | "level" | "noise")[]) {
    const { attachment, canEditSong } = await this.findVisible(viewer, songVersionId, attachmentId);
    if (!present(attachment, viewer, canEditSong).canChange) throw new ForbiddenException("Only its uploader or the song's editors can change this file");
    if (attachment.type !== "AUDIO") throw new BadRequestException("Only audio files can be processed");
    if (attachment.locked) throw new ForbiddenException("This file is locked: its uploader can unlock it on the Audio tab");
    if (attachment.processing === "PENDING") throw new BadRequestException("This file is already being processed");
    const row = await this.prisma.client.attachment.update({ where: { id: attachment.id }, data: { processing: "PENDING" }, include: ATTACHMENT_INCLUDE });
    await this.recordings.add(
      "process-take",
      { attachmentId: row.id, filename: row.filename, voice: steps.includes("voice"), level: steps.includes("level"), noise: steps.includes("noise"), quietFor: row.recordingFirstBeat },
      { attempts: 2, backoff: { type: "exponential", delay: 10000 }, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } },
    );
    return present(row, viewer, canEditSong);
  }

  /** A set the viewer's (theirs, or their team's) with the song in it: what a multitrack can be recorded for (issue #127). */
  private async assertSetOfSong(viewer: Viewer, setlistId: string, songVersionId: string) {
    const set = await this.prisma.client.setlist.findFirst({
      where: { id: setlistId, items: { some: { songVersionId } } },
      select: { ownerUserId: true, ownerTeamId: true },
    });
    const mine =
      !!set && (viewer.isGlobalAdmin || set.ownerUserId === viewer.id || (!!set.ownerTeamId && (await this.access.teamRole(viewer.id, set.ownerTeamId)) !== null));
    if (!mine) throw new BadRequestException("multitrackSetlistId must be a set of yours with this song in it");
  }

  /**
   * Plays this take of its part (issue #127) - instead of `instead`, which
   * becomes another take, when given. Both in the same multitrack, and the
   * viewer's to change.
   */
  async useTake(viewer: Viewer, songVersionId: string, attachmentId: string, instead: string | null) {
    const { attachment, canEditSong } = await this.findVisible(viewer, songVersionId, attachmentId);
    if (!present(attachment, viewer, canEditSong).canChange) throw new ForbiddenException("Only its uploader or the song's editors can change this file");
    const replaced = instead ? await this.findVisible(viewer, songVersionId, instead) : null;
    if (replaced) {
      if (!present(replaced.attachment, viewer, canEditSong).canChange) throw new ForbiddenException("Only its uploader or the song's editors can change the take it replaces");
      if (replaced.attachment.locked) throw new ForbiddenException("This file is locked: its uploader can unlock it on the Audio tab");
      if (replaced.attachment.id === attachment.id || (replaced.attachment.multitrackId ?? null) !== (attachment.multitrackId ?? null) || replaced.attachment.type !== "AUDIO") {
        throw new BadRequestException("instead must be another file of the same multitrack");
      }
    }
    await this.prisma.client.$transaction([
      this.prisma.client.attachment.update({ where: { id: attachment.id }, data: { otherTake: false } }),
      ...(replaced ? [this.prisma.client.attachment.update({ where: { id: replaced.attachment.id }, data: { otherTake: true } })] : []),
    ]);
    return this.listForSongVersion(viewer, songVersionId);
  }

  /**
   * An audio file's part of the song (a stem, #64), its recording's key
   * and tempo (#65) - for its uploader or who can edit the song - and who
   * sees it (#72), for its uploader. What's left out stays; null clears.
   */
  async update(viewer: Viewer, songVersionId: string, attachmentId: string, change: UpdateAttachmentDto) {
    const { attachment, canEditSong } = await this.findVisible(viewer, songVersionId, attachmentId);
    const rights = present(attachment, viewer, canEditSong);
    const data: Prisma.AttachmentUncheckedUpdateInput = recordingData(change);
    if (change.stemPart !== undefined) data.stemPart = change.stemPart;
    if (change.partName !== undefined) data.partName = change.partName;
    if (change.multitrackSetlistId) await this.assertSetOfSong(viewer, change.multitrackSetlistId, songVersionId);
    if (change.otherTake !== undefined) {
      if (attachment.type !== "AUDIO") throw new BadRequestException("Only audio files can be takes");
      if (change.otherTake && attachment.locked && !attachment.otherTake) throw new ForbiddenException("This file is locked: its uploader can unlock it on the Audio tab");
      data.otherTake = change.otherTake;
    }
    // The beat set by hand (issue #299): the detected beats and bars no longer hold, the tempo and first beat do.
    const beatSetByHand = (change.recordingTempo !== undefined || change.recordingFirstBeat !== undefined) && attachment.recordingBeats.length > 0;
    if (beatSetByHand) {
      data.recordingBeats = [];
      data.recordingDownbeats = [];
    }
    // What a separation's analysis found (issue #175): confirmed as it is, or by changing it.
    if (attachment.detected.length > 0) {
      const confirmed = change.confirmDetected
        ? attachment.detected
        : attachment.detected.filter((detail) => (DETECTED_FIELDS[detail] && change[DETECTED_FIELDS[detail]] !== undefined) || (detail === "beats" && beatSetByHand));
      if (confirmed.length > 0) data.detected = attachment.detected.filter((detail) => !confirmed.includes(detail));
    }
    // Locked or not (issue #145): its uploader's to decide, as who sees it is.
    if (change.locked !== undefined) {
      if (!rights.canChangeVisibility) throw new ForbiddenException("Only its uploader can lock or unlock this file");
      data.locked = change.locked;
    }
    if (attachment.type !== "AUDIO" && Object.values(data).some((value) => value !== null)) {
      throw new BadRequestException("Only audio files can be stems or have a recording's key and tempo");
    }
    if (Object.keys(data).some((field) => field !== "locked") && !rights.canChange) throw new ForbiddenException("Only its uploader or the song's editors can change this file");
    if (change.visibility !== undefined) {
      if (!rights.canChangeVisibility) throw new ForbiddenException("Only its uploader decides who sees this file");
      Object.assign(data, await this.audience(viewer, await this.songRights(viewer, songVersionId), change.visibility, change.teamId ?? null));
    }
    const row = await this.prisma.client.attachment.update({ where: { id: attachment.id }, data, include: ATTACHMENT_INCLUDE });
    return present(row, viewer, canEditSong);
  }

  /** One of the song's files the viewer sees, or 404. */
  async find(viewer: Viewer, songVersionId: string, attachmentId: string) {
    return (await this.findVisible(viewer, songVersionId, attachmentId)).attachment;
  }

  /** A resized WebP rendition of an image attachment (see ImageService.resize for sizing rules). */
  async resizedImage(viewer: Viewer, songVersionId: string, attachmentId: string, width: number): Promise<ProcessedImage> {
    const attachment = await this.find(viewer, songVersionId, attachmentId);
    if (attachment.type !== "IMAGE" && !attachment.mimeType.startsWith("image/")) {
      throw new UnsupportedMediaTypeException("This attachment isn't an image");
    }
    return this.images.resize(attachment.storageKey, () => this.storage.get(attachment.storageKey, attachment.storedInOrganizationId), width);
  }

  /**
   * Deletes the Attachment row, then deletes the underlying object only if
   * no other Attachment (in this or any other song version) or avatar still
   * references the same content hash - see docs/songbooks-and-catalog.md
   * §8. Checked on demand rather than via a maintained counter, which
   * could drift out of sync with the actual row count.
   */
  async remove(viewer: Viewer, songVersionId: string, attachmentId: string): Promise<void> {
    const { attachment, canEditSong } = await this.findVisible(viewer, songVersionId, attachmentId);
    if (!present(attachment, viewer, canEditSong).canChange) throw new ForbiddenException("Only its uploader or the song's editors can remove this file");
    if (attachment.locked) throw new ForbiddenException("This file is locked: its uploader can unlock it on the Audio tab");
    await this.prisma.client.attachment.delete({ where: { id: attachment.id } });
    await this.storage.deleteUnreferencedFiles([attachment]);
  }

  private async canEditSong(viewer: Viewer, songVersionId: string): Promise<boolean> {
    return (await this.songRights(viewer, songVersionId)).canEditSong;
  }

  private async songRights(viewer: Viewer, songVersionId: string) {
    const song = await this.prisma.client.songVersion.findUnique({
      where: { id: songVersionId },
      select: { ownerScope: true, ownerUserId: true, ownerTeamId: true },
    });
    if (!song) throw new NotFoundException("Song version not found");
    return { canEditSong: await this.access.canEdit(viewer, song), isGlobal: song.ownerScope === "GLOBAL" };
  }

  /** Checks who a file may be shown to, as the columns that say so. */
  private async audience(
    viewer: Viewer,
    { canEditSong, isGlobal }: { canEditSong: boolean; isGlobal: boolean },
    visibility: AttachmentVisibilityValue,
    teamId: string | null,
  ): Promise<{ visibility: AttachmentVisibilityValue; visibleToTeamId: string | null }> {
    if (visibility === "SONG" && !canEditSong) throw new ForbiddenException("Only who can edit the song can show a file to everyone who sees it");
    if (visibility === "SHARED") {
      if (!canEditSong) throw new ForbiddenException("Only who shares the song can show a file to the people it's shared with");
      if (isGlobal) throw new BadRequestException("A catalogue song isn't shared with anyone: everyone sees it");
    }
    if (visibility !== "TEAM") return { visibility, visibleToTeamId: null };
    if (!teamId) throw new BadRequestException("Choose the team that sees it");
    if (!viewer.isGlobalAdmin && !(await this.access.teamRole(viewer.id, teamId))) throw new ForbiddenException("Not a member of that team");
    return { visibility, visibleToTeamId: teamId };
  }

  /** A file of the song the viewer sees (404 otherwise, not telling hidden from missing). */
  private async findVisible(viewer: Viewer, songVersionId: string, attachmentId: string) {
    const [teamIds, canEditSong] = await Promise.all([this.access.teamIds(viewer.id), this.canEditSong(viewer, songVersionId)]);
    const attachment = await this.prisma.client.attachment.findFirst({
      where: { id: attachmentId, songVersionId, ...AttachmentsService.visibleWhere(viewer, teamIds) },
      include: ATTACHMENT_INCLUDE,
    });
    if (!attachment) throw new NotFoundException("Attachment not found");
    return { attachment, canEditSong };
  }
}

const ATTACHMENT_INCLUDE = {
  uploadedBy: { select: { id: true, displayName: true, avatarUrl: true } },
  visibleToTeam: { select: { id: true, name: true } },
  multitrackSetlist: { select: { id: true, name: true, eventDate: true, eventDateOf: { select: { id: true } } } },
} satisfies Prisma.AttachmentInclude;

type AttachmentRow = Prisma.AttachmentGetPayload<{ include: typeof ATTACHMENT_INCLUDE }>;

/**
 * A file as the viewer gets it: `canChange` (its part, key and tempo, or
 * removing it) for its uploader and who can edit the song;
 * `canChangeVisibility` for its uploader (or, for a file whose uploader
 * isn't known, the song's editors).
 */
/** An audio file's recording details (#65, #100) and multitrack (#123): what's left out stays, null clears. */
export interface RecordingChange {
  recordingKey?: string | null;
  recordingTempo?: number | null;
  recordingFirstBeat?: number | null;
  recordingFreeIntro?: boolean;
  recordingTimeSignature?: string | null;
  pitchOffset?: number | null;
  multitrackId?: string | null;
  multitrackName?: string | null;
  multitrackSetlistId?: string | null;
  cuePoints?: { at: number; sectionId: string }[] | null;
}

/** Which change confirms each detail a separation's analysis found (issue #175). */
const DETECTED_FIELDS: Record<string, "recordingKey" | "recordingTempo" | "recordingTimeSignature" | "recordingFirstBeat" | "cuePoints"> = {
  key: "recordingKey",
  tempo: "recordingTempo",
  timeSignature: "recordingTimeSignature",
  firstBeat: "recordingFirstBeat",
  sections: "cuePoints",
};

const WAV_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);
/** A WAV file's bitrate (bits a second), from its header; null when it isn't a WAV file. */
function wavBitrate(body: Buffer): number | null {
  return body.length >= 44 && body.toString("latin1", 0, 4) === "RIFF" && body.toString("latin1", 8, 12) === "WAVE" ? body.readUInt32LE(28) * 8 : null;
}

/** Uncompressed or lossless: always above 320 kbps for music, so made Opus (issue #182). */
const LOSSLESS_TYPES = new Set([...WAV_TYPES, "audio/flac", "audio/x-flac", "audio/aiff", "audio/x-aiff"]);

function recordingData(change: RecordingChange): Omit<Prisma.AttachmentUncheckedCreateInput, "songVersionId" | "type" | "filename" | "mimeType" | "storageKey"> {
  const data: Record<string, unknown> = {};
  if (change.recordingKey !== undefined) {
    // Kept as written ("Gb" stays "Gb"), once it reads as a key.
    const written = change.recordingKey?.trim() ?? "";
    if (written && !parseKey(written)) throw new BadRequestException(`"${written}" isn't a key Songverse can read`);
    data.recordingKey = written || null;
  }
  // Cue points (issue #110): in time order; none is no column at all.
  if (change.cuePoints !== undefined) {
    (data as Record<string, unknown>).cuePoints = change.cuePoints?.length ? [...change.cuePoints].sort((a, b) => a.at - b.at) : Prisma.DbNull;
  }
  for (const field of ["recordingTempo", "recordingFirstBeat", "recordingFreeIntro", "recordingTimeSignature", "pitchOffset", "multitrackId", "multitrackName", "multitrackSetlistId"] as const) {
    if (change[field] !== undefined) (data as Record<string, unknown>)[field] = change[field];
  }
  return data as Omit<Prisma.AttachmentUncheckedCreateInput, "songVersionId" | "type" | "filename" | "mimeType" | "storageKey">;
}

function present(row: AttachmentRow, viewer: Viewer, canEditSong: boolean) {
  const mine = row.uploadedByUserId === viewer.id;
  const set = row.multitrackSetlist;
  const { originalStorageKey, originalMimeType, originalSizeBytes, ...rest } = row;
  return {
    ...rest,
    // A lossless upload's original kept beside it (issue #182): downloaded at /original.
    original: originalStorageKey ? { mimeType: originalMimeType ?? "audio/flac", sizeBytes: originalSizeBytes } : null,
    // The set its multitrack was recorded for (issue #127), named as sets are: its date a calendar day.
    multitrackSetlist: set ? { id: set.id, name: set.name, eventDate: set.eventDate ? set.eventDate.toISOString().slice(0, 10) : null, fromEvent: !!set.eventDateOf } : null,
    mine,
    canChange: viewer.isGlobalAdmin || canEditSong || mine,
    canChangeVisibility: viewer.isGlobalAdmin || mine || (row.uploadedByUserId === null && canEditSong),
  };
}
