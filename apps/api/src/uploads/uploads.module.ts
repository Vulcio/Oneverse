import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module.js";
import { AdminFileSizeLimitsController, UploadsController } from "./uploads.controller.js";

@Module({ imports: [StorageModule], controllers: [UploadsController, AdminFileSizeLimitsController] })
export class UploadsModule {}
