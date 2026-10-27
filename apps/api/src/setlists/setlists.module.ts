import { Module } from "@nestjs/common";
import { ArrangementsModule } from "../arrangements/arrangements.module.js";
import { OwnershipRequestsController } from "./ownership-requests.controller.js";
import { SetInvitesController } from "./set-invites.controller.js";
import { SetlistAccessService } from "./setlist-access.service.js";
import { SetlistSharingService } from "./setlist-sharing.service.js";
import { SetlistsController } from "./setlists.controller.js";
import { SetlistsService } from "./setlists.service.js";
import { SongOwnershipService } from "./song-ownership.service.js";
import { SongTeamsController } from "./song-teams.controller.js";
import { NotesService } from "../notes/notes.service.js";
import { ScripturesModule } from "../scriptures/scriptures.module.js";

@Module({
  imports: [ArrangementsModule, ScripturesModule],
  controllers: [SetlistsController, SetInvitesController, OwnershipRequestsController, SongTeamsController],
  // Notes (issue #256) live with sets: who sees a set's notes is the set's to say, and its offline copy carries them.
  providers: [SetlistAccessService, SetlistsService, SetlistSharingService, SongOwnershipService, NotesService],
  exports: [SetlistsService, SetlistAccessService, NotesService],
})
export class SetlistsModule {}
