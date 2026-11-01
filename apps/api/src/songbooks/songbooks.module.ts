import { Module } from "@nestjs/common";
import { SongVersionsModule } from "../song-versions/song-versions.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { SongbookEntriesController, SongbooksController } from "./songbooks.controller.js";
import { SongbooksService } from "./songbooks.service.js";
import { SongbookSongInfoController } from "./songbook-song-info.controller.js";
import { SongbookGiveController, SongbookSharesController } from "./songbook-shares.controller.js";
import { SongbookSharesService } from "./songbook-shares.service.js";
import { SongOwnershipService } from "../setlists/song-ownership.service.js";

@Module({
  imports: [SongVersionsModule, StorageModule],
  controllers: [SongbooksController, SongbookEntriesController, SongbookSharesController, SongbookGiveController, SongbookSongInfoController],
  // SongOwnershipService: one's own song shared with or moved to the team whose songbook it goes in (issue #340).
  providers: [SongbooksService, SongbookSharesService, SongOwnershipService],
  exports: [SongbooksService],
})
export class SongbooksModule {}
