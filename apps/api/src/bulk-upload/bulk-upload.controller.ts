import { Body, Controller, Param, PayloadTooLargeException, Post, UnauthorizedException, UseGuards, UseInterceptors, UploadedFiles } from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { BULK_UPLOAD_MAX_FILES_PER_REQUEST } from "@oneverse/core";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { SongbookManagerGuard } from "../common/guards/songbook-manager.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { BulkUploadService } from "./bulk-upload.service.js";
import { BulkUploadCommitDto } from "./dto/bulk-upload-commit.dto.js";
import { BulkUploadPreviewDto } from "./dto/bulk-upload-preview.dto.js";
import { BulkUploadCommitResultDto, BulkUploadFileMatchDto } from "./dto/bulk-upload-response.dto.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { BYTES_PER_MB, fileSizeLimitsFor } from "../uploads/file-size-limits.js";
import { SongFileInterceptor } from "../uploads/song-file.interceptor.js";


@ApiTags("bulk-upload")
@ApiBearerAuth()
@Controller("songbooks/:songbookId/bulk-upload")
// Its owner's: a bulk upload writes into the owner's songs, not for someone it's shared with to edit (issue #211).
@UseGuards(SongbookManagerGuard)
export class BulkUploadController {
  constructor(private readonly bulkUploadService: BulkUploadService) {}

  @Post("preview")
  @ApiOkResponse({ type: BulkUploadFileMatchDto, isArray: true })
  preview(
    @Param("songbookId") songbookId: string,
    @Body() dto: BulkUploadPreviewDto,
  ): ReturnType<BulkUploadService["preview"]> {
    return this.bulkUploadService.preview(songbookId, dto.filenames, dto.type);
  }

  @RateLimit("heavy")
  @Post()
  @UseInterceptors(SongFileInterceptor("files", BULK_UPLOAD_MAX_FILES_PER_REQUEST))
  @ApiConsumes("multipart/form-data")
  @ApiCreatedResponse({ type: BulkUploadCommitResultDto })
  async commit(
    @Param("songbookId") songbookId: string,
    @Body() dto: BulkUploadCommitDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<Awaited<ReturnType<BulkUploadService["commit"]>>> {
    if (!user) throw new UnauthorizedException();
    // Each file within its type's limit (issue #163), set in Admin > Storage.
    const limitMb = (await fileSizeLimitsFor(user))[dto.type];
    const tooBig = (files ?? []).find((file) => file.size > limitMb * BYTES_PER_MB);
    if (tooBig) throw new PayloadTooLargeException(`${tooBig.originalname}: ${dto.type === "PDF" ? "PDF" : "ChordPro"} files can be up to ${limitMb} MB`);
    return this.bulkUploadService.commit(user.id, songbookId, dto.type, files ?? []);
  }
}
