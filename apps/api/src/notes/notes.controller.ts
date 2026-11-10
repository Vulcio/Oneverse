import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { CreateNoteDto, ListNotesQueryDto, NoteReplyDto, UpdateNoteDto } from "./notes.dto.js";
import { NotesService } from "./notes.service.js";

/** The notes on a song one sees (issue #256), opened in a set or a songbook. */
@ApiTags("notes")
@ApiBearerAuth()
@Controller("song-versions/:songVersionId/notes")
export class SongNotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Query() query: ListNotesQueryDto) {
    return this.notes.list(user, songVersionId, query);
  }
}

/** Notes on songs (issue #256): written, changed, resolved, replied to. */
@ApiTags("notes")
@ApiBearerAuth()
@Controller("notes")
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post()
  create(@SignedIn() user: AuthenticatedUser, @Body() dto: CreateNoteDto) {
    return this.notes.create(user, dto);
  }

  @Patch(":noteId")
  update(@SignedIn() user: AuthenticatedUser, @Param("noteId") noteId: string, @Body() dto: UpdateNoteDto) {
    return this.notes.update(user, noteId, dto);
  }

  @Delete(":noteId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@SignedIn() user: AuthenticatedUser, @Param("noteId") noteId: string) {
    return this.notes.remove(user, noteId);
  }

  @Post(":noteId/replies")
  reply(@SignedIn() user: AuthenticatedUser, @Param("noteId") noteId: string, @Body() dto: NoteReplyDto) {
    return this.notes.reply(user, noteId, dto.content);
  }

  @Patch(":noteId/replies/:replyId")
  updateReply(@SignedIn() user: AuthenticatedUser, @Param("noteId") noteId: string, @Param("replyId") replyId: string, @Body() dto: NoteReplyDto) {
    return this.notes.updateReply(user, noteId, replyId, dto.content);
  }

  @Delete(":noteId/replies/:replyId")
  removeReply(@SignedIn() user: AuthenticatedUser, @Param("noteId") noteId: string, @Param("replyId") replyId: string) {
    return this.notes.removeReply(user, noteId, replyId);
  }
}
