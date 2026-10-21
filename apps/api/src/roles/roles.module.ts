import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module.js";
import { AdminRolesController } from "./roles.controller.js";
import { RolesService } from "./roles.service.js";
import { ScopedRolesController } from "./scoped-roles.controller.js";

@Module({
  imports: [StorageModule],
  controllers: [AdminRolesController, ScopedRolesController],
  providers: [RolesService],
})
export class RolesModule {}
