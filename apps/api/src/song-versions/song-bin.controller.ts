import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { SongBinService, type BinnedSong, type SongUsage } from "./song-bin.service.js";

const signedIn = (user: AuthenticatedUser | undefined): AuthenticatedUser => {
  if (!user) throw new UnauthorizedException();
  return user;
};

/** Where a song is used, before deleting it (issue #340). */
@ApiTags("song-versions")
@ApiBearerAuth()
@Controller("song-versions/:songVersionId/usage")
export class SongUsageController {
  constructor(private readonly bin: SongBinService) {}

  @Get()
  usage(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songVersionId") songVersionId: string): Promise<SongUsage> {
    return this.bin.usage(signedIn(user), songVersionId);
  }
}

/** The bin (issue #340): deleted songs, put back or deleted for good. */
@ApiTags("song-versions")
@ApiBearerAuth()
@Controller("song-bin")
export class SongBinController {
  constructor(private readonly bin: SongBinService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser | undefined): Promise<BinnedSong[]> {
    return this.bin.list(signedIn(user));
  }

  @Post(":songVersionId/restore")
  @HttpCode(HttpStatus.NO_CONTENT)
  restore(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songVersionId") songVersionId: string): Promise<void> {
    return this.bin.restore(signedIn(user), songVersionId);
  }

  @Delete(":songVersionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteForGood(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songVersionId") songVersionId: string): Promise<void> {
    return this.bin.deleteForGood(signedIn(user), songVersionId);
  }
}
