import { LinkMusicBrainzSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class LinkMusicBrainzDto extends zodDto(LinkMusicBrainzSchema) {}
