import { Body, Controller, Get, HttpCode, Param, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ApplySongInfoRefreshSchema, StartSongInfoRefreshSchema } from "@oneverse/core";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { SongbookOwnerGuard } from "../common/guards/songbook-owner.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { SongbookSongInfoService } from "../song-versions/songbook-song-info.service.js";

class StartSongInfoRefreshDto extends zodDto(StartSongInfoRefreshSchema) {}
class ApplySongInfoRefreshDto extends zodDto(ApplySongInfoRefreshSchema) {}

/**
 * A songbook's songs and their details (issue #353): edited in place, and
 * brought up to date from the metadata providers in one pass. For those
 * who change the songbook; each song is only changed by who may change it.
 */
@ApiTags("songbooks")
@ApiBearerAuth()
@Controller("songbooks/:songbookId/song-info")
@UseGuards(SongbookOwnerGuard)
export class SongbookSongInfoController {
  constructor(private readonly songInfo: SongbookSongInfoService) {}

  private static who(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) throw new UnauthorizedException();
    return user;
  }

  @Get()
  table(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songbookId") songbookId: string) {
    return this.songInfo.table(SongbookSongInfoController.who(user), songbookId);
  }

  @Post("refreshes")
  @RateLimit("heavy")
  start(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songbookId") songbookId: string, @Body() dto: StartSongInfoRefreshDto) {
    return this.songInfo.start(SongbookSongInfoController.who(user), songbookId, dto.songVersionIds);
  }

  @Get("refreshes/latest")
  latest(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songbookId") songbookId: string) {
    return this.songInfo.latest(SongbookSongInfoController.who(user), songbookId);
  }

  @Get("refreshes/:refreshId")
  view(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songbookId") songbookId: string, @Param("refreshId") refreshId: string) {
    return this.songInfo.view(SongbookSongInfoController.who(user), songbookId, refreshId);
  }

  @Post("refreshes/:refreshId/apply")
  @HttpCode(200)
  apply(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songbookId") songbookId: string, @Param("refreshId") refreshId: string, @Body() dto: ApplySongInfoRefreshDto) {
    return this.songInfo.apply(SongbookSongInfoController.who(user), songbookId, refreshId, dto.songs);
  }
}
