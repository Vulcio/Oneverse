import { AddQuickSelectionSchema, CreateSetlistSchema, UpdateSetlistSchema, AddSetlistItemSchema, SetlistOfflineQuerySchema, UpdateSetlistItemSchema, SetArrangementSchema, ReorderSetlistItemsSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class CreateSetlistDto extends zodDto(CreateSetlistSchema) {}

export class UpdateSetlistDto extends zodDto(UpdateSetlistSchema) {}

export class AddSetlistItemDto extends zodDto(AddSetlistItemSchema) {}

export class SetlistOfflineQueryDto extends zodDto(SetlistOfflineQuerySchema) {}

export class UpdateSetlistItemDto extends zodDto(UpdateSetlistItemSchema) {}

export class SetArrangementDto extends zodDto(SetArrangementSchema) {}

export class ReorderSetlistItemsDto extends zodDto(ReorderSetlistItemsSchema) {}


export class AddQuickSelectionDto extends zodDto(AddQuickSelectionSchema) {}
