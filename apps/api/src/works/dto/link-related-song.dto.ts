import { LinkRelatedSongSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class LinkRelatedSongDto extends zodDto(LinkRelatedSongSchema) {}
