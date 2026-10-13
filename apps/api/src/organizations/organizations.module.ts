import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module.js";
import { TeamsService } from "../teams/teams.service.js";
import { AdminOrganizationsController, OrganizationsController, TeamOrganizationController } from "./organizations.controller.js";
import { OrganizationsService } from "./organizations.service.js";

@Module({
  imports: [StorageModule],
  controllers: [OrganizationsController, TeamOrganizationController, AdminOrganizationsController],
  providers: [OrganizationsService, TeamsService],
})
export class OrganizationsModule {}
