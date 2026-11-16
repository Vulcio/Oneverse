import { SaveAuthConfigSchema, SendTestEmailSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SaveAuthConfigDto extends zodDto(SaveAuthConfigSchema) {}

export class SendTestEmailDto extends zodDto(SendTestEmailSchema) {}
