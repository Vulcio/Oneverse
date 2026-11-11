import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { SongBinService, type BinnedSong, type SongUsage } from "./song-bin.service.js";

/** Where a song is used, before deleting it (issue #340). */
@ApiTags("song-versions")
@ApiBearerAuth()
@Controller("song-versions/:songVersionId/usage")
export class SongUsageController {
  constructor(private readonly bin: SongBinService) {}

  @Get()
  usage(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string): Promise<SongUsage> {
    return this.bin.usage(user, songVersionId);
  }
}

/** The bin (issue #340): deleted songs, put back or deleted for good. */
@ApiTags("song-versions")
@ApiBearerAuth()
@Controller("song-bin")
export class SongBinController {
  constructor(private readonly bin: SongBinService) {}

  @Get()
  list(@SignedIn() user: AuthenticatedUser): Promise<BinnedSong[]> {
    return this.bin.list(user);
  }

  @Post(":songVersionId/restore")
  @HttpCode(HttpStatus.NO_CONTENT)
  restore(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string): Promise<void> {
    return this.bin.restore(user, songVersionId);
  }

  @Delete(":songVersionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteForGood(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string): Promise<void> {
    return this.bin.deleteForGood(user, songVersionId);
  }
}
