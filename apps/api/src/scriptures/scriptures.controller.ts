import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import { YouVersionBiblesQuerySchema, YouVersionKeySchema, YouVersionPassageQuerySchema } from "@oneverse/core";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { zodDto } from "../common/zod-validation.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { YouVersionService } from "./youversion.service.js";

export class YouVersionKeyDto extends zodDto(YouVersionKeySchema) {}

export class YouVersionBiblesQueryDto extends zodDto(YouVersionBiblesQuerySchema) {}

export class YouVersionPassageQueryDto extends zodDto(YouVersionPassageQuerySchema) {}

/**
 * Bibles from YouVersion's Platform API (issue #304), for anyone signed in,
 * and its App Key for the admin. Its text is never stored, nor kept by
 * whoever asked: every answer is `no-store`.
 */
@ApiTags("scriptures")
@ApiBearerAuth()
@Controller()
export class ScripturesController {
  constructor(private readonly youversion: YouVersionService) {}

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
