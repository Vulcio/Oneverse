import { Module } from "@nestjs/common";
import { SetlistsModule } from "../setlists/setlists.module.js";
import { NotesController, SongNotesController } from "./notes.controller.js";

/** Notes' endpoints; NotesService is SetlistsModule's (a set's offline copy carries its notes). */
@Module({
  imports: [SetlistsModule],
  controllers: [SongNotesController, NotesController],
})
export class NotesModule {}
