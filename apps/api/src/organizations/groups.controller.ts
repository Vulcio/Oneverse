import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { TeamAdminGuard } from "../common/guards/team-admin.guard.js";
import { TeamMemberGuard } from "../common/guards/team-member.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { CreateGroupDto } from "./dto/create-group.dto.js";
import { SetMemberPositionsDto } from "./dto/set-member-positions.dto.js";
import { TeamPositionDto } from "./dto/team-position.dto.js";
import { UpdateGroupDto } from "./dto/update-group.dto.js";
import { GroupsService } from "./groups.service.js";

function signedIn(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}

/** An organisation's groups and their positions (issue #241). */
@ApiTags("teams")
@ApiBearerAuth()
@Controller()
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post("organizations/:organizationId/groups")
  create(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Body() dto: CreateGroupDto) {
    return this.groups.create(signedIn(user), organizationId, dto);
  }

  @Patch("teams/:teamId/group")
  @UseGuards(TeamAdminGuard)
  update(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(signedIn(user), teamId, dto);
  }

  @Get("teams/:teamId/positions")
  @UseGuards(TeamMemberGuard)
  positions(@Param("teamId") teamId: string) {
    return this.groups.positions(teamId);
  }

  @Post("teams/:teamId/positions")
  @UseGuards(TeamAdminGuard)
  createPosition(@Param("teamId") teamId: string, @Body() dto: TeamPositionDto) {
    return this.groups.createPosition(teamId, dto.name);
  }

  @Patch("teams/:teamId/positions/:positionId")
  @UseGuards(TeamAdminGuard)
  renamePosition(@Param("teamId") teamId: string, @Param("positionId") positionId: string, @Body() dto: TeamPositionDto) {
    return this.groups.renamePosition(teamId, positionId, dto.name);
  }

  @Delete("teams/:teamId/positions/:positionId")
  @UseGuards(TeamAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePosition(@Param("teamId") teamId: string, @Param("positionId") positionId: string) {
    return this.groups.deletePosition(teamId, positionId);
  }

  @Put("teams/:teamId/members/:userId/positions")
  @UseGuards(TeamMemberGuard)
  setMemberPositions(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Param("userId") userId: string, @Body() dto: SetMemberPositionsDto) {
    return this.groups.setMemberPositions(signedIn(user), teamId, userId, dto.positionIds);
  }
}
