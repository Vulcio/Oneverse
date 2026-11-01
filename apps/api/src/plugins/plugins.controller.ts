import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ChordSearchQuerySchema, PluginEnabledSchema, SongProviderOrderSchema, SongProviderSourceSchema, SongProviderSourceUpdateSchema } from "@oneverse/core";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { zodDto } from "../common/zod-validation.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { PluginsService } from "./plugins.service.js";
import { SongProviderService } from "./song-provider/song-provider.service.js";
import { createSource, deleteSource, reorderSources, testSource, updateSource } from "./song-provider/song-provider-sources.js";

export class PluginEnabledDto extends zodDto(PluginEnabledSchema) {}
export class SongProviderSourceDto extends zodDto(SongProviderSourceSchema) {}
export class SongProviderSourceUpdateDto extends zodDto(SongProviderSourceUpdateSchema) {}
export class SongProviderOrderDto extends zodDto(SongProviderOrderSchema) {}
export class ChordSearchQueryDto extends zodDto(ChordSearchQuerySchema) {}

/** Admin > Plugins (issue #157): the built-in plugins, on or off, and the Song provider plugin's servers. */
@ApiTags("plugins")
@ApiBearerAuth()
@Controller("admin/plugins")
@UseGuards(GlobalAdminGuard)
export class AdminPluginsController {
  constructor(private readonly plugins: PluginsService) {}

  @Get()
  list() {
    return this.plugins.list();
  }

  @Put(":id")
  setEnabled(@Param("id") id: string, @Body() dto: PluginEnabledDto) {
    return this.plugins.setEnabled(id, dto.enabled);
  }

  /** Back to PLUGINS_ENABLED, or off. */
  @Delete(":id")
  reset(@Param("id") id: string) {
    return this.plugins.reset(id);
  }

  /** A Song provider API server added: it must answer its capabilities first. */
  @Post("song-provider/sources")
  @RateLimit("heavy")
  async addSource(@Body() dto: SongProviderSourceDto) {
    await createSource(dto);
    return this.plugins.list();
  }

  @Patch("song-provider/sources/:sourceId")
  @RateLimit("heavy")
  async updateSource(@Param("sourceId") sourceId: string, @Body() dto: SongProviderSourceUpdateDto) {
    await updateSource(sourceId, dto);
    return this.plugins.list();
  }

  @Delete("song-provider/sources/:sourceId")
  async removeSource(@Param("sourceId") sourceId: string) {
    await deleteSource(sourceId);
    return this.plugins.list();
  }

  @Put("song-provider/order")
  async reorder(@Body() dto: SongProviderOrderDto) {
    await reorderSources(dto.ids);
    return this.plugins.list();
  }

  @Post("song-provider/sources/:sourceId/test")
  @HttpCode(200)
  @RateLimit("heavy")
  test(@Param("sourceId") sourceId: string) {
    return testSource(sourceId);
  }
}

/** The plugins' hooks people use (issue #157): Find chords, at the Song provider plugin's servers. Read only. */
@ApiTags("plugins")
@ApiBearerAuth()
@Controller("plugins")
export class PluginsController {
  constructor(private readonly songProviders: SongProviderService) {}

  /** Whether Find chords has anywhere to look. */
  @Get("chords")
  chordsAvailable() {
    return this.songProviders.chordsAvailable();
  }

  @Get("chords/search")
  @RateLimit("heavy")
  searchChords(@Query() query: ChordSearchQueryDto) {
    return this.songProviders.searchChords(query.title, query.artist, query.language);
  }

  @Get("chords/:providerId/songs/:songId")
  @RateLimit("heavy")
  chordContent(@Param("providerId") providerId: string, @Param("songId") songId: string) {
    if (!songId.trim() || songId.length > 200) throw new BadRequestException(["songId must be at most 200 characters"]);
    return this.songProviders.chordContent(providerId, songId);
  }
}
