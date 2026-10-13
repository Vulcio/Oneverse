import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { TeamEventsModule } from "../team-events/team-events.module.js";
import { OrganizationEventsController } from "./organization-events.controller.js";
import { OrganizationEventsService } from "./organization-events.service.js";
import { TeamsService } from "../teams/teams.service.js";
import { AdminOrganizationsController, OrganizationsController, TeamOrganizationController } from "./organizations.controller.js";
import { GroupsController } from "./groups.controller.js";
import { GroupsService } from "./groups.service.js";
import { OrganizationsService } from "./organizations.service.js";

@Module({
  imports: [StorageModule, TeamEventsModule, NotificationsModule],
  controllers: [OrganizationsController, TeamOrganizationController, AdminOrganizationsController, GroupsController, OrganizationEventsController],
  providers: [OrganizationsService, GroupsService, TeamsService, OrganizationEventsService],
})
export class OrganizationsModule {}
