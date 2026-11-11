import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ApplySongInfoRefreshSchema, StartSongInfoRefreshSchema } from "@oneverse/core";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
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

  @Get()
  table(@SignedIn() user: AuthenticatedUser, @Param("songbookId") songbookId: string) {
    return this.songInfo.table(user, songbookId);
  }

  @Post("refreshes")
  @RateLimit("heavy")
  start(@SignedIn() user: AuthenticatedUser, @Param("songbookId") songbookId: string, @Body() dto: StartSongInfoRefreshDto) {
    return this.songInfo.start(user, songbookId, dto.songVersionIds);
  }

  @Get("refreshes/latest")
  latest(@SignedIn() user: AuthenticatedUser, @Param("songbookId") songbookId: string) {
    return this.songInfo.latest(user, songbookId);
  }

  @Get("refreshes/:refreshId")
  view(@SignedIn() user: AuthenticatedUser, @Param("songbookId") songbookId: string, @Param("refreshId") refreshId: string) {
    return this.songInfo.view(user, songbookId, refreshId);
  }

  @Post("refreshes/:refreshId/apply")
  @HttpCode(200)
  apply(@SignedIn() user: AuthenticatedUser, @Param("songbookId") songbookId: string, @Param("refreshId") refreshId: string, @Body() dto: ApplySongInfoRefreshDto) {
    return this.songInfo.apply(user, songbookId, refreshId, dto.songs);
  }
}
