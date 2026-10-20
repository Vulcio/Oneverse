import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module.js";
import { BrandsController } from "./brands.controller.js";
import { BrandsService } from "./brands.service.js";

/** Brand kits (issue #279). */
@Module({
  imports: [StorageModule],
  controllers: [BrandsController],
  providers: [BrandsService],
  exports: [BrandsService],
})
export class BrandsModule {}
