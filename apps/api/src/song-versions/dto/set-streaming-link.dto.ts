import { SetStreamingLinkSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SetStreamingLinkDto extends zodDto(SetStreamingLinkSchema) {}
