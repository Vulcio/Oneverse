import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { AppleMusicKeySchema, LinkSearchTypeSchema, MetadataLookupSchema, MetadataSearchQuerySchema, MetadataSettingsSchema, MusicBrainzContactSchema, SpotifyAppSchema, YouTubeKeySchema } from "@oneverse/core";
import { zodDto } from "../common/zod-validation.js";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { MetadataService } from "./metadata.service.js";

export class MetadataSearchQueryDto extends zodDto(MetadataSearchQuerySchema) {}

export class MetadataLookupDto extends zodDto(MetadataLookupSchema) {}

export class SpotifyAppDto extends zodDto(SpotifyAppSchema) {}

export class MusicBrainzContactDto extends zodDto(MusicBrainzContactSchema) {}

export class MetadataSettingsDto extends zodDto(MetadataSettingsSchema) {}

export class AppleMusicKeyDto extends zodDto(AppleMusicKeySchema) {}

export class YouTubeKeyDto extends zodDto(YouTubeKeySchema) {}

/**
 * Metadata providers (issue #22): Auto detect's search - read only, like
 * the MusicBrainz proxy; linking a match goes through the song's own
 * endpoint, which checks edit rights - and the admin's settings.
 */
@ApiTags("metadata")
@ApiBearerAuth()
@Controller()
export class MetadataController {
  constructor(private readonly metadata: MetadataService) {}

  @Get("metadata/search")
  search(@Query() query: MetadataSearchQueryDto) {
    return this.metadata.search(query.title, query.artist);
  }

  /**
   * A match looked up again from its sources, with everything they know
   * (its tempo, length, writers), for the review before it's used (issue
   * #352): read only, like the search.
   */
  @Post("metadata/lookup")
  @HttpCode(200)
  @RateLimit("heavy")
  lookup(@Body() dto: MetadataLookupDto) {
    return this.metadata.lookup(dto.sources);
  }

  /** Which services a song's links can be searched at (issue #169). */
  @Get("metadata/links")
  linkSearchServices() {
    return this.metadata.linkSearchServices();
  }

  /** A song looked up at one service, for its link (issue #169): read only, like the search above. */
  @Get("metadata/links/:type/search")
  // An outside lookup - YouTube's spends its key's daily quota.
  @RateLimit("heavy")
  searchLinks(@Param("type") type: string, @Query() query: MetadataSearchQueryDto) {
    const parsed = LinkSearchTypeSchema.safeParse(type);
    if (!parsed.success) throw new BadRequestException(["type must be one of SPOTIFY, APPLE_MUSIC, DEEZER, YOUTUBE"]);
    return this.metadata.linkSearch(parsed.data, query.title, query.artist);
  }

  @Get("admin/metadata")
  @UseGuards(GlobalAdminGuard)
  settings() {
    return this.metadata.settings();
  }

  @Put("admin/metadata")
  @UseGuards(GlobalAdminGuard)
  save(@Body() dto: MetadataSettingsDto) {
    return this.metadata.saveSettings(dto.providers);
  }

  @Delete("admin/metadata")
  @UseGuards(GlobalAdminGuard)
  reset() {
    return this.metadata.resetSettings();
  }

  /** The Apple Music API's MusicKit key (issue #87). */
  @Put("admin/metadata/apple-music")
  @UseGuards(GlobalAdminGuard)
  saveAppleMusic(@Body() dto: AppleMusicKeyDto) {
    return this.metadata.saveAppleMusic(dto);
  }

  @Delete("admin/metadata/apple-music")
  @UseGuards(GlobalAdminGuard)
  resetAppleMusic() {
    return this.metadata.resetAppleMusic();
  }

  @Post("admin/metadata/apple-music/test")
  @UseGuards(GlobalAdminGuard)
  testAppleMusic() {
    return this.metadata.testAppleMusic();
  }

  /** Spotify's developer app (issue #89). */
  @Put("admin/metadata/spotify")
  @UseGuards(GlobalAdminGuard)
  saveSpotify(@Body() dto: SpotifyAppDto) {
    return this.metadata.saveSpotify(dto);
  }

  @Delete("admin/metadata/spotify")
  @UseGuards(GlobalAdminGuard)
  resetSpotify() {
    return this.metadata.resetSpotify();
  }

  @Post("admin/metadata/spotify/test")
  @UseGuards(GlobalAdminGuard)
  testSpotify() {
    return this.metadata.testSpotify();
  }

  /** The YouTube Data API's key (issue #169), for the song links' YouTube search. */
  @Put("admin/metadata/youtube")
  @UseGuards(GlobalAdminGuard)
  saveYouTube(@Body() dto: YouTubeKeyDto) {
    return this.metadata.saveYouTube(dto.apiKey);
  }

  @Delete("admin/metadata/youtube")
  @UseGuards(GlobalAdminGuard)
  resetYouTube() {
    return this.metadata.resetYouTube();
  }

  @Post("admin/metadata/youtube/test")
  @UseGuards(GlobalAdminGuard)
  testYouTube() {
    return this.metadata.testYouTube();
  }

  /** MusicBrainz's contact, in the User-Agent (issue #89); empty goes back to MUSICBRAINZ_CONTACT. */
  @Put("admin/metadata/musicbrainz")
  @UseGuards(GlobalAdminGuard)
  saveMusicBrainz(@Body() dto: MusicBrainzContactDto) {
    return this.metadata.saveMusicBrainz(dto.contact);
  }
}
