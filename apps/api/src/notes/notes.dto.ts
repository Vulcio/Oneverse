import { CreateNoteSchema, ListNotesQuerySchema, NoteReplySchema, UpdateNoteSchema } from "@songverse/core";
import { zodDto } from "../common/zod-validation.js";

export class CreateNoteDto extends zodDto(CreateNoteSchema) {}
export class UpdateNoteDto extends zodDto(UpdateNoteSchema) {}
export class NoteReplyDto extends zodDto(NoteReplySchema) {}
export class ListNotesQueryDto extends zodDto(ListNotesQuerySchema) {}
