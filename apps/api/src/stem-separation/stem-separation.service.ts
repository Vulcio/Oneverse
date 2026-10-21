import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import type { StemSeparationParts } from "@oneverse/core";
import type { Queue } from "bullmq";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AccessPolicyService, type Viewer } from "../access/access-policy.service.js";
import { AttachmentsService } from "../attachments/attachments.service.js";
import { STEM_SEPARATION_QUEUE } from "../jobs/jobs.constants.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { capabilitiesOf, monthlyLimitOf } from "../roles/capabilities.js";
import type { SubmitSeparationJob } from "./stem-separation.processor.js";
import { serverById, serverForSong, serverOfSeparation, type SeparationServer } from "./sonic-servers.js";
import { callbackSecret } from "./stem-separation-settings.js";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const JOB_OPTIONS = { attempts: 3, backoff: { type: "exponential", delay: 30000 }, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } } as const;

/** Why a user can't split a song's recordings, if they can't. */
export type SeparationRefusal = "not-configured" | "not-granted";

/** Where a server's webhooks come: this API's callback, naming a team's or an organisation's server (issue #300). */
function callbackFor(base: string | null, server: Pick<SeparationServer, "id">): string | null {
  return base && server.id ? `${base}/${server.id}` : base;
}

/**
 * Splitting a song's recordings into stems (issue #63), from the API: who
 * may, starting one - the Worker sends it - listing them, trying again, and
 * the Sonic servers' webhooks. A song is split on its team's or its
 * organisation's own Sonic server when it has one (issue #300), where the
 * team's members may; else on the instance's, for global admins and
 * someone with a role that allows it - theirs or their team's, issue #160 -
 * on songs they can edit or their team's.
 */
@Injectable()
export class StemSeparationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly attachments: AttachmentsService,
    @InjectQueue(STEM_SEPARATION_QUEUE) private readonly queue: Queue,
  ) {}

  /** Whether `viewer` may split this song's recordings, or why not. */
  async refusal(viewer: Viewer, songVersionId: string): Promise<SeparationRefusal | null> {
    return (await this.check(viewer, songVersionId)).refusal;
  }

  /** The server this song's recordings would be split on, and whether `viewer` may. */
  private async check(viewer: Viewer, songVersionId: string): Promise<{ server: SeparationServer | null; refusal: SeparationRefusal | null }> {
    const song = await this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { id: true, ownerScope: true, ownerUserId: true, ownerTeamId: true } });
    if (!song) throw new NotFoundException("Song version not found");
    const server = await serverForSong(songVersionId);
    if (!server) return { server, refusal: "not-configured" };
    if (viewer.isGlobalAdmin) return { server, refusal: null };
    const teamMember = song.ownerScope === "TEAM" && song.ownerTeamId ? Boolean(await this.access.teamRole(viewer.id, song.ownerTeamId)) : false;
    // A team's or an organisation's own server: the song's team's members, no role needed.
    if (server.owner) return { server, refusal: teamMember ? null : "not-granted" };
    const { canSeparateStems } = await capabilitiesOf(this.prisma.client, viewer.id);
    if (!canSeparateStems) return { server, refusal: "not-granted" };
    if (teamMember || (await this.access.canEditContent(viewer, song))) return { server, refusal: null };
    return { server, refusal: "not-granted" };
  }

  async list(viewer: Viewer, songVersionId: string) {
    await this.access.assertCanSeeSong(viewer, songVersionId);
    const { server, refusal } = await this.check(viewer, songVersionId);
    const rows = await this.prisma.client.stemSeparation.findMany({
      where: { songVersionId, ...(viewer.isGlobalAdmin || !refusal ? {} : { requestedByUserId: viewer.id }) },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { requestedBy: { select: { displayName: true } } },
    });
    return {
      available: !refusal,
      refusal,
      /** Whose Sonic server it would go to (issue #300): a team's or an organisation's, else null for the instance's. */
      server: server?.owner ? { kind: server.owner.kind, name: server.owner.name } : null,
      separations: rows.map((row) => ({
        id: row.id,
        sourceAttachmentId: row.sourceAttachmentId,
        parts: row.parts as StemSeparationParts,
        status: row.status,
        hqRequested: row.hqRequested,
        hqDone: row.hqDone,
        fastModel: row.fastModel,
        hqModel: row.hqModel,
        sourceFilename: row.sourceFilename,
        multitrackId: row.multitrackId,
        replacesMultitrackId: row.replacesMultitrackId,
        error: row.error,
        requestedBy: row.requestedBy?.displayName ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** Starts one: checked here, sent by the Worker. `callbackUrl`, where the Demucs API's webhooks come (this API). */
  async start(viewer: Viewer, songVersionId: string, attachmentId: string, parts: StemSeparationParts, callbackUrl: string | null, replace = false) {
    const { server, refusal } = await this.check(viewer, songVersionId);
    if (refusal === "not-configured" || !server) throw new BadRequestException("Stem separation isn't set up yet: an admin sets it up in Admin > Stem separation");
    if (refusal) throw new ForbiddenException("Splitting recordings into stems needs a role that allows it: an admin gives it");
    const source = await this.attachments.find(viewer, songVersionId, attachmentId);
    if (source.type !== "AUDIO") throw new BadRequestException("Only a recording can be split into stems");
    // On a team's or an organisation's server, the limit its admins set, counted there; on the instance's, the largest
    // the viewer's roles allow, a role without its own counting as Admin > Stem separation's.
    const limit = viewer.isGlobalAdmin ? null : server.owner ? server.monthlyLimit : monthlyLimitOf(await capabilitiesOf(this.prisma.client, viewer.id), server.monthlyLimit);
    if (limit !== null) {
      const used = await this.prisma.client.stemSeparation.count({ where: { requestedByUserId: viewer.id, sonicServerId: server.id, ownServer: Boolean(server.owner), status: { not: "FAILED" }, createdAt: { gte: new Date(Date.now() - MONTH_MS) } } });
      if (used >= limit) throw new HttpException({ statusCode: 429, message: [`You've reached the limit of ${limit} separations in 30 days: try again later`] }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const running = await this.prisma.client.stemSeparation.count({ where: { sourceAttachmentId: attachmentId, status: { in: ["QUEUED", "SUBMITTED"] } } });
    if (running) throw new BadRequestException("This recording is already being split");
    // The instance's, made now while there's a key to keep it with: the Worker signs nothing, it only passes it on.
    if (!server.owner) await callbackSecret();
    // Replacing (issue #175): the stems of this recording's latest separation still on the song.
    let replacesMultitrackId: string | null = null;
    if (replace) {
      const earlier = await this.prisma.client.stemSeparation.findMany({ where: { songVersionId, sourceAttachmentId: attachmentId, multitrackId: { not: null } }, orderBy: { createdAt: "desc" }, select: { multitrackId: true } });
      for (const { multitrackId } of earlier) {
        if (await this.prisma.client.attachment.count({ where: { songVersionId, multitrackId, origin: "SEPARATED" } })) {
          replacesMultitrackId = multitrackId;
          break;
        }
      }
    }
    const separation = await this.prisma.client.stemSeparation.create({
      data: {
        songVersionId,
        sourceAttachmentId: attachmentId,
        sourceFilename: source.filename,
        requestedByUserId: viewer.id,
        parts,
        // No finer pass for 6 parts (issue #174): there's no fine-tuned 6-part model, and a 4-part one would
        // put the guitar and piano back in "other", to be heard twice.
        hqRequested: server.hqEnabled && parts !== "6",
        replacesMultitrackId,
        sonicServerId: server.id,
        ownServer: Boolean(server.owner),
      },
    });
    await this.queue.add("submit", { separationId: separation.id, callbackUrl: callbackFor(callbackUrl, server), filename: source.filename } satisfies SubmitSeparationJob, JOB_OPTIONS);
    return (await this.list(viewer, songVersionId)).separations.find((row) => row.id === separation.id)!;
  }

  /** A failed one, sent again (the same recording and parts). */
  async retry(viewer: Viewer, separationId: string, callbackUrl: string | null) {
    const separation = await this.prisma.client.stemSeparation.findUnique({ where: { id: separationId } });
    if (!separation || (separation.requestedByUserId !== viewer.id && !viewer.isGlobalAdmin)) throw new NotFoundException("Separation not found");
    if (separation.status !== "FAILED") throw new BadRequestException("Only a separation that failed can be tried again");
    // Sent again where it went the first time: its server must still be there.
    const server = await serverOfSeparation(separation);
    if (!server) throw new BadRequestException("The Sonic server it was sent to is no longer connected: start a new one");
    await this.prisma.client.stemSeparation.update({ where: { id: separation.id }, data: { status: "QUEUED", error: null, jobId: null } });
    await this.queue.add("submit", { separationId: separation.id, callbackUrl: callbackFor(callbackUrl, server) } satisfies SubmitSeparationJob, JOB_OPTIONS);
  }

  /**
   * A Sonic server's webhook - the instance's, or the team's or
   * organisation's server `serverId` names: its signature (HMAC-SHA256 of
   * the raw body) checked with that server's secret, then the Worker told
   * to bring in what's ready. Anything unsigned or unknown is refused - the
   * webhook is only a nudge: the Worker asks the server itself what the
   * job has.
   */
  async callback(rawBody: Buffer | undefined, signature: string | undefined, serverId: string | null = null): Promise<void> {
    const secret = (await serverById(serverId))?.callbackSecret;
    if (!secret || !rawBody || !signature) throw new ForbiddenException("Unsigned");
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ForbiddenException("Bad signature");
    let jobId: string | undefined;
    try {
      jobId = (JSON.parse(rawBody.toString("utf8")) as { job_id?: string }).job_id;
    } catch {
      throw new BadRequestException("Not JSON");
    }
    if (!jobId) return;
    // Its job on that server: another server's job can have the same ID.
    const separation = await this.prisma.client.stemSeparation.findFirst({ where: { jobId, sonicServerId: serverId, ownServer: serverId !== null }, select: { id: true } });
    if (separation) await this.queue.add("sync", { separationId: separation.id }, { removeOnComplete: { count: 200 }, removeOnFail: { count: 200 }, attempts: 3, backoff: { type: "exponential", delay: 30000 } });
  }
}
