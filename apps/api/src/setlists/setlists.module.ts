import { Module } from "@nestjs/common";
import { ArrangementsModule } from "../arrangements/arrangements.module.js";
import { OwnershipRequestsController } from "./ownership-requests.controller.js";
import { SetInvitesController } from "./set-invites.controller.js";
import { SetlistAccessService } from "./setlist-access.service.js";
import { SetlistSharingService } from "./setlist-sharing.service.js";
import { SetlistsController } from "./setlists.controller.js";
import { SetlistsService } from "./setlists.service.js";
import { QuickSelectionController } from "./quick-selection.controller.js";
import { QuickSelectionService } from "./quick-selection.service.js";
import { SongOwnershipService } from "./song-ownership.service.js";
import { SongTeamsController } from "./song-teams.controller.js";
import { OperatorPresetsController } from "./operator-presets.controller.js";
import { OperatorPresetsService } from "./operator-presets.service.js";
import { NotesService } from "../notes/notes.service.js";
import { ScripturesModule } from "../scriptures/scriptures.module.js";
import { TeamEventsModule } from "../team-events/team-events.module.js";
import { SetAvailabilityService } from "./set-availability.service.js";

@Module({
  imports: [ArrangementsModule, ScripturesModule, TeamEventsModule],
  controllers: [SetlistsController, SetInvitesController, OwnershipRequestsController, SongTeamsController, QuickSelectionController, OperatorPresetsController],
  // Notes (issue #256) live with sets: who sees a set's notes is the set's to say, and its offline copy carries them.
  providers: [SetlistAccessService, SetAvailabilityService, OperatorPresetsService, SetlistsService, QuickSelectionService, SetlistSharingService, SongOwnershipService, NotesService],
  exports: [SetlistsService, SetlistAccessService, NotesService],
})
export class SetlistsModule {}
