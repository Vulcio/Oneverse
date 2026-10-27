import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MoveSongToTeamSchema } from "@oneverse/core";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { ShareDto } from "../people/people.dto.js";
import { requireUser } from "./setlists.controller.js";
import { SongOwnershipService } from "./song-ownership.service.js";

class MoveSongToTeamDto extends zodDto(MoveSongToTeamSchema) {}

/** A song and teams (issue #331, see SongOwnershipService): sharing it with them, moving it to one. */
@ApiTags("song-versions")
@ApiBearerAuth()
@Controller("song-versions/:songVersionId")
export class SongTeamsController {
  constructor(private readonly ownership: SongOwnershipService) {}

  /** The teams it's shared with (who manages it). */
  @Get("shares/teams")
  async teamShares(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songVersionId") songVersionId: string) {
    await this.ownership.assertManages(requireUser(user), songVersionId);
    return this.ownership.teamShares(songVersionId);
  }

  @Put("shares/teams/:teamId")
  async share(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songVersionId") songVersionId: string, @Param("teamId") teamId: string, @Body() dto: ShareDto) {
    await this.ownership.shareWithTeam(requireUser(user), songVersionId, teamId, dto.canEdit);
    return this.ownership.teamShares(songVersionId);
  }

  @Delete("shares/teams/:teamId")
  async unshare(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songVersionId") songVersionId: string, @Param("teamId") teamId: string) {
    await this.ownership.unshareTeam(requireUser(user), songVersionId, teamId);
    return this.ownership.teamShares(songVersionId);
  }

  /** Makes a personal song the team's: `moved`, or offered to the team's admins. */
  @Post("move-to-team")
  move(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songVersionId") songVersionId: string, @Body() dto: MoveSongToTeamDto) {
    return this.ownership.move(requireUser(user), songVersionId, dto.teamId);
  }
}
