import { SaveOrganizationSettingsSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SaveOrganizationSettingsDto extends zodDto(SaveOrganizationSettingsSchema) {}
