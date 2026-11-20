import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AnnouncementsService } from "./announcements.service.js";
import { CreateAnnouncementDto, SaveOrganizationAnnouncementDto, SaveTeamAnnouncementDto, UpdateAnnouncementDto } from "./dto/announcements.dto.js";

/** Admin > Announcements (issue #536): news for everyone, an app's people, or an organisation. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/announcements")
@UseGuards(GlobalAdminGuard)
export class AdminAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  /** Drafts and sent ones, newest first: a draft with how many it would go to now. */
  @Get()
  list() {
    return this.announcements.list();
  }

  @Post()
  create(@SignedIn() user: AuthenticatedUser, @Body() dto: CreateAnnouncementDto) {
    return this.announcements.create(user, dto);
  }

  /** A draft changed; a sent one's words only, fixed in everyone's notifications. */
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcements.update(id, dto);
  }

  /** Sent to its audience, as notifications (the bell, push, email as each person chooses). */
  @Post(":id/send")
  @HttpCode(HttpStatus.OK)
  send(@Param("id") id: string) {
    return this.announcements.send(id);
  }

  /** A draft deleted, or a sent one taken back from everyone's notifications. */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string): Promise<void> {
    await this.announcements.remove(id);
  }
}

/** An organisation's announcements to its members (issue #536), for its admins. */
@ApiTags("organizations")
@ApiBearerAuth()
@Controller("organizations/:organizationId/announcements")
export class OrganizationAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.announcements.listForOrganization(user, organizationId);
  }

  @Post()
  create(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Body() dto: SaveOrganizationAnnouncementDto) {
    return this.announcements.createForOrganization(user, organizationId, dto);
  }

  @Patch(":id")
  update(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("id") id: string, @Body() dto: SaveOrganizationAnnouncementDto) {
    return this.announcements.updateForOrganization(user, organizationId, id, dto);
  }

  @Post(":id/send")
  @HttpCode(HttpStatus.OK)
  send(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("id") id: string) {
    return this.announcements.sendForOrganization(user, organizationId, id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("id") id: string): Promise<void> {
    await this.announcements.removeForOrganization(user, organizationId, id);
  }
}

/** A team's announcements to its members (issue #536), for its admins. */
@ApiTags("teams")
@ApiBearerAuth()
@Controller("teams/:teamId/announcements")
export class TeamAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@SignedIn() user: AuthenticatedUser, @Param("teamId") teamId: string) {
    return this.announcements.listForTeam(user, teamId);
  }

  @Post()
  create(@SignedIn() user: AuthenticatedUser, @Param("teamId") teamId: string, @Body() dto: SaveTeamAnnouncementDto) {
    return this.announcements.createForTeam(user, teamId, dto);
  }

  @Patch(":id")
  update(@SignedIn() user: AuthenticatedUser, @Param("teamId") teamId: string, @Param("id") id: string, @Body() dto: SaveTeamAnnouncementDto) {
    return this.announcements.updateForTeam(user, teamId, id, dto);
  }

  @Post(":id/send")
  @HttpCode(HttpStatus.OK)
  send(@SignedIn() user: AuthenticatedUser, @Param("teamId") teamId: string, @Param("id") id: string) {
    return this.announcements.sendForTeam(user, teamId, id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@SignedIn() user: AuthenticatedUser, @Param("teamId") teamId: string, @Param("id") id: string): Promise<void> {
    await this.announcements.removeForTeam(user, teamId, id);
  }
}
