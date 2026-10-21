import type { AttachmentTypeValue } from "@oneverse/core";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AccessPolicyService } from "../access/access-policy.service.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AttachmentsService } from "./attachments.service.js";
import { AttachmentResponseDto } from "./dto/attachment-response.dto.js";
import { ProcessAttachmentDto, UpdateAttachmentDto, UploadAttachmentDto, UseTakeDto } from "./dto/upload-attachment.dto.js";
import { sniffAudioType } from "./sniff-audio.js";
import { FileLinksService } from "../files/file-links.service.js";
import { sendFile } from "../files/send-file.js";
import { StorageService } from "../storage/storage.service.js";
import { RateLimit } from "../security/rate-limit.decorator.js";

import { BYTES_PER_MB, fileSizeLimitsFor } from "../uploads/file-size-limits.js";
import { SongFileInterceptor } from "../uploads/song-file.interceptor.js";

/** How a type is called in a message. */
const FILE_TYPE_NAMES: Record<AttachmentTypeValue, string> = {
  PDF: "PDF",
  CHORDPRO: "ChordPro",
  MUSICXML: "MusicXML",
  ABC_NOTATION: "ABC notation",
  TEXT: "Text",
  IMAGE: "Image",
  AUDIO: "Audio",
  OTHER: "Other",
};

@ApiTags("attachments")
@ApiBearerAuth()
@Controller("song-versions/:songVersionId/attachments")
export class AttachmentsController {
  constructor(
    private readonly attachmentsService: AttachmentsService,
    private readonly access: AccessPolicyService,
    private readonly links: FileLinksService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOkResponse({ type: AttachmentResponseDto, isArray: true })
  async list(
    @Param("songVersionId") songVersionId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<Awaited<ReturnType<AttachmentsService["listForSongVersion"]>>> {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.attachmentsService.listForSongVersion(user, songVersionId);
  }

  /** Anyone who can see the song adds their own files; who else sees each is up to them (issue #72). */
  @RateLimit("heavy")
  @Post()
  @UseInterceptors(SongFileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiCreatedResponse({ type: AttachmentResponseDto })
  async upload(
    @Param("songVersionId") songVersionId: string,
    @Body() dto: UploadAttachmentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): ReturnType<AttachmentsService["upload"]> {
    if (!user) throw new UnauthorizedException();
    if (!file) throw new BadRequestException("A file is required");
    await this.access.assertCanSeeSong(user, songVersionId);
    // Its type's limit (issue #163), set in Admin > Storage; a global admin's, the server's (#183).
    const limitMb = (await fileSizeLimitsFor(user))[dto.type];
    if (file.size > limitMb * BYTES_PER_MB) throw new PayloadTooLargeException(`${FILE_TYPE_NAMES[dto.type]} files can be up to ${limitMb} MB`);
    let mimeType = file.mimetype;
    if (dto.type === "AUDIO") {
      // Browsers give some audio files (.opus, say) no type or a generic one: then the bytes decide.
      if (!mimeType.startsWith("audio/")) mimeType = sniffAudioType(file.buffer) ?? mimeType;
      if (!mimeType.startsWith("audio/")) throw new UnsupportedMediaTypeException("That isn't an audio file");
      // A WAV with nothing after its header (a take where nothing was captured) can't be played anywhere.
      if (file.buffer.length <= 44 && file.buffer.toString("ascii", 0, 4) === "RIFF") throw new BadRequestException("The recording is empty");
    }
    return this.attachmentsService.upload(
      user,
      songVersionId,
      dto.type,
      file.originalname,
      mimeType,
      file.buffer,
      dto.stemPart ?? null,
      dto.visibility ?? "PRIVATE",
      dto.teamId ?? null,
      {
        recordingKey: dto.recordingKey,
        recordingTempo: dto.recordingTempo,
        recordingTimeSignature: dto.recordingTimeSignature,
        recordingFirstBeat: dto.recordingFirstBeat,
        recordingFreeIntro: dto.recordingFreeIntro,
        pitchOffset: dto.pitchOffset,
        multitrackId: dto.multitrackId,
        multitrackName: dto.multitrackName,
        multitrackSetlistId: dto.multitrackSetlistId,
      },
      { process: dto.process, otherTake: dto.otherTake, partName: dto.partName },
    );
  }

  /** An audio file's part of the song, for the stem player (#64), its recording's key and tempo (#65), and who sees it (#72). */
  @Patch(":attachmentId")
  @ApiOkResponse({ type: AttachmentResponseDto })
  async update(
    @Param("songVersionId") songVersionId: string,
    @Param("attachmentId") attachmentId: string,
    @Body() dto: UpdateAttachmentDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): ReturnType<AttachmentsService["update"]> {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.attachmentsService.update(user, songVersionId, attachmentId, dto);
  }

  /** Plays this take of its part (issue #127), instead of another file of its multitrack, which is kept as another take. Answers the song's files. */
  @Post(":attachmentId/use-take")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AttachmentResponseDto, isArray: true })
  async useTake(
    @Param("songVersionId") songVersionId: string,
    @Param("attachmentId") attachmentId: string,
    @Body() dto: UseTakeDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): ReturnType<AttachmentsService["useTake"]> {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.attachmentsService.useTake(user, songVersionId, attachmentId, dto.instead ?? null);
  }

  /** Cleans up an audio file afterwards (issue #132), in the background: RNNoise on a voice, its level, its noise. It comes back as Opus, a new file. */
  @Post(":attachmentId/process")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOkResponse({ type: AttachmentResponseDto })
  async process(
    @Param("songVersionId") songVersionId: string,
    @Param("attachmentId") attachmentId: string,
    @Body() dto: ProcessAttachmentDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): ReturnType<AttachmentsService["process"]> {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.attachmentsService.process(user, songVersionId, attachmentId, dto.steps);
  }

  /**
   * Streamed, with byte ranges (issue #33). Not rate limited (issue #113):
   * a read of a file the user may already open, and a device keeping its
   * sets offline downloads every file of every song at once - counted, the
   * stem player's own downloads were refused behind them.
   */
  @RateLimit("none")
  @Get(":attachmentId/download")
  async download(
    @Param("songVersionId") songVersionId: string,
    @Param("attachmentId") attachmentId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    const attachment = await this.attachmentsService.find(user, songVersionId, attachmentId);
    await sendFile(this.storage, attachment, req, res, "attachment");
  }

  /** A lossless upload's original, as FLAC (issue #182), kept beside the Opus copy that's played. */
  @RateLimit("none")
  @Get(":attachmentId/original")
  async original(
    @Param("songVersionId") songVersionId: string,
    @Param("attachmentId") attachmentId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    const attachment = await this.attachmentsService.find(user, songVersionId, attachmentId);
    if (!attachment.originalStorageKey) throw new NotFoundException("This file has no original kept");
    await sendFile(
      this.storage,
      {
        storageKey: attachment.originalStorageKey,
        mimeType: attachment.originalMimeType ?? "audio/flac",
        filename: attachment.filename.replace(/\.[a-z0-9]{1,5}$/i, "") + ".flac",
        sizeBytes: attachment.originalSizeBytes,
      },
      req,
      res,
      "attachment",
    );
  }

  /**
   * A short-lived link to the file (GET /files/:id), for what can't send a
   * Bearer token - an <audio src> streaming and seeking (issue #33), and
   * pdf.js reading a PDF by byte ranges, its first page first (issue #156).
   * For audio and PDFs only (issue #112): anything else is downloaded with
   * the Bearer token. A PDF's link, opened in a tab, downloads it rather
   * than showing it there.
   */
  @Post(":attachmentId/link")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: "`path` is under the API's own address; the link stops working at `expiresAt`." })
  async link(
    @Param("songVersionId") songVersionId: string,
    @Param("attachmentId") attachmentId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<{ path: string; expiresAt: string }> {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    const attachment = await this.attachmentsService.find(user, songVersionId, attachmentId);
    const pdf = attachment.mimeType === "application/pdf";
    if (attachment.type !== "AUDIO" && !pdf) throw new BadRequestException("Only audio files and PDFs have links");
    return this.links.create(attachment.id);
  }

  /** Resized for display, e.g. thumbnails: `w` snaps up to a fixed set of widths (32-2048) and never enlarges. */
  @RateLimit("none")
  @Get(":attachmentId/image")
  async image(
    @Param("songVersionId") songVersionId: string,
    @Param("attachmentId") attachmentId: string,
    @Query("w") width: string | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!user) throw new UnauthorizedException();
    if (width === undefined) throw new BadRequestException("The w (width) query parameter is required");
    await this.access.assertCanSeeSong(user, songVersionId);
    const { body, contentType } = await this.attachmentsService.resizedImage(user, songVersionId, attachmentId, Number(width));
    res.set({
      "Content-Type": contentType,
      // Attachments are never edited in place, so a rendition never changes.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(body);
  }

  @Delete(":attachmentId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("songVersionId") songVersionId: string,
    @Param("attachmentId") attachmentId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<void> {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.attachmentsService.remove(user, songVersionId, attachmentId);
  }
}
