import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { BiblePassageQuerySchema, BibleUpdateSchema, YouVersionBiblesQuerySchema, YouVersionKeySchema, YouVersionPassageQuerySchema } from "@oneverse/core";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { zodDto } from "../common/zod-validation.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { UPLOAD_OPTIONS } from "../common/uploads.js";
import { BiblesService, MAX_BIBLE_FILE_BYTES } from "./bibles.service.js";
import { YouVersionService } from "./youversion.service.js";

export class YouVersionKeyDto extends zodDto(YouVersionKeySchema) {}
export class YouVersionBiblesQueryDto extends zodDto(YouVersionBiblesQuerySchema) {}

export class YouVersionPassageQueryDto extends zodDto(YouVersionPassageQuerySchema) {}

export class BibleUpdateDto extends zodDto(BibleUpdateSchema) {}

export class BiblePassageQueryDto extends zodDto(BiblePassageQuerySchema) {}

/**
 * Bibles for anyone signed in: those imported from files (issue #301), and
 * YouVersion's Platform API (issue #304), whose text is never stored, nor
 * kept by whoever asked: every answer from it is `no-store`. The admin
 * imports Bibles, says what they may be used for, and sets YouVersion's
 * App Key.
 */
@ApiTags("scriptures")
@ApiBearerAuth()
@Controller()
export class ScripturesController {
  constructor(
    private readonly youversion: YouVersionService,
    private readonly imported: BiblesService,
  ) {}

  /** The imported Bibles, with what each may be used for. */
  @Get("scriptures/bibles")
  importedBibles() {
    return this.imported.list();
  }

  @Get("scriptures/bibles/:id/passage")
  importedPassage(@Param("id") id: string, @Query() query: BiblePassageQueryDto) {
    return this.imported.passage(id, query.reference);
  }

  @Get("admin/scriptures/bibles")
  @UseGuards(GlobalAdminGuard)
  adminBibles() {
    return this.imported.adminList();
  }

  /** A Bible file (Zefania, Beblia, OSIS or json-bible), imported by the Worker. */
  @Post("admin/scriptures/bibles")
  @UseGuards(GlobalAdminGuard)
  @UseInterceptors(FileInterceptor("file", { ...UPLOAD_OPTIONS, limits: { fileSize: MAX_BIBLE_FILE_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } })
  importBible(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException(["file must be a Bible file"]);
    return this.imported.import(file);
  }

  @Patch("admin/scriptures/bibles/:id")
  @UseGuards(GlobalAdminGuard)
  updateBible(@Param("id") id: string, @Body() dto: BibleUpdateDto) {
    return this.imported.update(id, dto);
  }

  @Delete("admin/scriptures/bibles/:id")
  @UseGuards(GlobalAdminGuard)
  @HttpCode(204)
  async removeBible(@Param("id") id: string) {
    await this.imported.remove(id);
  }

  /** Which outside Bible providers are set up. */
  @Get("scriptures/providers")
  providers() {
    return this.youversion.available();
  }

  @Get("scriptures/youversion/bibles")
  @RateLimit("heavy")
  bibles(@Query() query: YouVersionBiblesQueryDto) {
    return this.youversion.bibles(query.language);
  }

  @Get("scriptures/youversion/bibles/:id/passage")
  @RateLimit("heavy")
  async passage(@Param("id", ParseIntPipe) id: number, @Query() query: YouVersionPassageQueryDto, @Res({ passthrough: true }) res: Response) {
    if (id < 1) throw new BadRequestException(["id must be a YouVersion version's number"]);
    res.set("Cache-Control", "no-store");
    return this.youversion.passage(id, query.reference);
  }

  @Get("admin/scriptures/youversion")
  @UseGuards(GlobalAdminGuard)
  settings() {
    return this.youversion.settings();
  }

  @Put("admin/scriptures/youversion")
  @UseGuards(GlobalAdminGuard)
  saveKey(@Body() dto: YouVersionKeyDto) {
    return this.youversion.saveKey(dto.appKey);
  }

  @Delete("admin/scriptures/youversion")
  @UseGuards(GlobalAdminGuard)
  resetKey() {
    return this.youversion.resetKey();
  }

  @Post("admin/scriptures/youversion/test")
  @UseGuards(GlobalAdminGuard)
  test() {
    return this.youversion.test();
  }
}
