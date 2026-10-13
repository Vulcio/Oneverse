import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module.js";
import { TeamsService } from "../teams/teams.service.js";
import { AdminOrganizationsController, OrganizationsController, TeamOrganizationController } from "./organizations.controller.js";
import { GroupsController } from "./groups.controller.js";
import { GroupsService } from "./groups.service.js";
import { OrganizationsService } from "./organizations.service.js";

@Module({
  imports: [StorageModule],
  controllers: [OrganizationsController, TeamOrganizationController, AdminOrganizationsController, GroupsController],
  providers: [OrganizationsService, GroupsService, TeamsService],
})
export class OrganizationsModule {}
