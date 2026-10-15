import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { CreateNoteDto, ListNotesQueryDto, NoteReplyDto, UpdateNoteDto } from "./notes.dto.js";
import { NotesService } from "./notes.service.js";

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}

/** The notes on a song one sees (issue #256), opened in a set or a songbook. */
@ApiTags("notes")
@ApiBearerAuth()
@Controller("song-versions/:songVersionId/notes")
export class SongNotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songVersionId") songVersionId: string, @Query() query: ListNotesQueryDto) {
    return this.notes.list(requireUser(user), songVersionId, query);
  }
}

/** Notes on songs (issue #256): written, changed, resolved, replied to. */
@ApiTags("notes")
@ApiBearerAuth()
@Controller("notes")
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateNoteDto) {
    return this.notes.create(requireUser(user), dto);
  }

  @Patch(":noteId")
  update(@CurrentUser() user: AuthenticatedUser | undefined, @Param("noteId") noteId: string, @Body() dto: UpdateNoteDto) {
    return this.notes.update(requireUser(user), noteId, dto);
  }

  @Delete(":noteId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser | undefined, @Param("noteId") noteId: string) {
    return this.notes.remove(requireUser(user), noteId);
  }

  @Post(":noteId/replies")
  reply(@CurrentUser() user: AuthenticatedUser | undefined, @Param("noteId") noteId: string, @Body() dto: NoteReplyDto) {
    return this.notes.reply(requireUser(user), noteId, dto.content);
  }

  @Patch(":noteId/replies/:replyId")
  updateReply(@CurrentUser() user: AuthenticatedUser | undefined, @Param("noteId") noteId: string, @Param("replyId") replyId: string, @Body() dto: NoteReplyDto) {
    return this.notes.updateReply(requireUser(user), noteId, replyId, dto.content);
  }

  @Delete(":noteId/replies/:replyId")
  removeReply(@CurrentUser() user: AuthenticatedUser | undefined, @Param("noteId") noteId: string, @Param("replyId") replyId: string) {
    return this.notes.removeReply(requireUser(user), noteId, replyId);
  }
}
