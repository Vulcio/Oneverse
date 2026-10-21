import { AddSongbookEntrySchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class AddSongbookEntryDto extends zodDto(AddSongbookEntrySchema) {}
