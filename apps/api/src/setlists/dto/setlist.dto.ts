import { AddQuickSelectionSchema, OperatorPresetsSchema, CreateSetlistSchema, UpdateSetlistSchema, AddSetlistItemSchema, SetlistOfflineQuerySchema, UpdateSetlistItemSchema, SetArrangementSchema, ReorderSetlistItemsSchema, DecideSetEditRequestSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class CreateSetlistDto extends zodDto(CreateSetlistSchema) {}

export class UpdateSetlistDto extends zodDto(UpdateSetlistSchema) {}

export class AddSetlistItemDto extends zodDto(AddSetlistItemSchema) {}

export class SetlistOfflineQueryDto extends zodDto(SetlistOfflineQuerySchema) {}

export class UpdateSetlistItemDto extends zodDto(UpdateSetlistItemSchema) {}

export class SetArrangementDto extends zodDto(SetArrangementSchema) {}

export class ReorderSetlistItemsDto extends zodDto(ReorderSetlistItemsSchema) {}


export class AddQuickSelectionDto extends zodDto(AddQuickSelectionSchema) {}

/** The operator's named timers and quick messages (issue #358). */
export class SaveOperatorPresetsDto extends zodDto(OperatorPresetsSchema) {}
export class DecideSetEditRequestDto extends zodDto(DecideSetEditRequestSchema) {}
