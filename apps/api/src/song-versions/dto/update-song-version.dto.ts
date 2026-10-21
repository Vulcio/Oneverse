import { LinkRepeatsSchema, UpdateSongVersionSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

/** Partial update: a field left out is left alone; null (or "") clears it. */
export class UpdateSongVersionDto extends zodDto(UpdateSongVersionSchema) {}

/** Repeats linked (issue #231). */
export class LinkRepeatsDto extends zodDto(LinkRepeatsSchema) {}
