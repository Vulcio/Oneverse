import { SaveSecuritySettingsSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SaveSecuritySettingsDto extends zodDto(SaveSecuritySettingsSchema) {}
