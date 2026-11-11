import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MoveSongToTeamSchema } from "@oneverse/core";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { ShareDto } from "../people/people.dto.js";
import { SongOwnershipService } from "./song-ownership.service.js";

class MoveSongToTeamDto extends zodDto(MoveSongToTeamSchema) {}

/** A song and teams (issue #331, see SongOwnershipService): sharing it with them or an organisation (#350), moving it to one. */
@ApiTags("song-versions")
@ApiBearerAuth()
@Controller("song-versions/:songVersionId")
export class SongTeamsController {
  constructor(private readonly ownership: SongOwnershipService) {}

  /** The teams it's shared with (who manages it). */
  @Get("shares/teams")
  async teamShares(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    await this.ownership.assertManages(user, songVersionId);
    return this.ownership.teamShares(songVersionId);
  }

  @Put("shares/teams/:teamId")
  async share(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Param("teamId") teamId: string, @Body() dto: ShareDto) {
    await this.ownership.shareWithTeam(user, songVersionId, teamId, dto.canEdit);
    return this.ownership.teamShares(songVersionId);
  }

  @Delete("shares/teams/:teamId")
  async unshare(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Param("teamId") teamId: string) {
    await this.ownership.unshareTeam(user, songVersionId, teamId);
    return this.ownership.teamShares(songVersionId);
  }

  /** The organisations it's shared with (issue #350; who manages it). */
  @Get("shares/organizations")
  async organizationShares(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    await this.ownership.assertManages(user, songVersionId);
    return this.ownership.organizationShares(songVersionId);
  }

  /** Shares it with everyone in an organisation one is in, to view. */
  @Put("shares/organizations/:organizationId")
  async shareWithOrganization(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Param("organizationId") organizationId: string) {
    await this.ownership.shareWithOrganization(user, songVersionId, organizationId);
    return this.ownership.organizationShares(songVersionId);
  }

  @Delete("shares/organizations/:organizationId")
  async unshareOrganization(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Param("organizationId") organizationId: string) {
    await this.ownership.unshareOrganization(user, songVersionId, organizationId);
    return this.ownership.organizationShares(songVersionId);
  }

  /** Makes a personal song the team's: `moved`, or offered to the team's admins. */
  @Post("move-to-team")
  move(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Body() dto: MoveSongToTeamDto) {
    return this.ownership.move(user, songVersionId, dto.teamId);
  }
}
