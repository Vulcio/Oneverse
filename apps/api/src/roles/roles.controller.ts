import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AssignRolesSchema, CreateRoleSchema, UpdateRoleSchema } from "@oneverse/core";
import { zodDto } from "../common/zod-validation.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { RolesService } from "./roles.service.js";

class CreateRoleDto extends zodDto(CreateRoleSchema) {}
class UpdateRoleDto extends zodDto(UpdateRoleSchema) {}
class AssignRolesDto extends zodDto(AssignRolesSchema) {}

/** Admin > Roles, and the roles of Admin > Users and Admin > Teams (issue #160). */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(GlobalAdminGuard)
export class AdminRolesController {
  constructor(private readonly roles: RolesService) {}

  @Get("roles")
  list(): ReturnType<RolesService["list"]> {
    return this.roles.list();
  }

  @Post("roles")
  create(@Body() dto: CreateRoleDto): ReturnType<RolesService["create"]> {
    return this.roles.create(dto);
  }

  @Patch("roles/:roleId")
  @HttpCode(HttpStatus.NO_CONTENT)
  update(@Param("roleId") roleId: string, @Body() dto: UpdateRoleDto): Promise<void> {
    return this.roles.update(roleId, dto);
  }

  @Delete("roles/:roleId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("roleId") roleId: string): Promise<void> {
    return this.roles.remove(roleId);
  }

  @Put("users/:userId/roles")
  @HttpCode(HttpStatus.NO_CONTENT)
  setUserRoles(@Param("userId") userId: string, @Body() dto: AssignRolesDto): Promise<void> {
    return this.roles.setUserRoles(userId, dto.roleIds);
  }

  @Get("teams")
  listTeams(): ReturnType<RolesService["listTeams"]> {
    return this.roles.listTeams();
  }

  @Put("teams/:teamId/roles")
  @HttpCode(HttpStatus.NO_CONTENT)
  setTeamRoles(@Param("teamId") teamId: string, @Body() dto: AssignRolesDto): Promise<void> {
    return this.roles.setTeamRoles(teamId, dto.roleIds);
  }
}
