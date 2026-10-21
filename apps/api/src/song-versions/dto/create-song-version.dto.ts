import { CreateSongVersionSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class CreateSongVersionDto extends zodDto(CreateSongVersionSchema) {}
