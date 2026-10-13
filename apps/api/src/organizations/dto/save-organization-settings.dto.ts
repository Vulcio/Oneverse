import { SaveOrganizationSettingsSchema } from "@songverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SaveOrganizationSettingsDto extends zodDto(SaveOrganizationSettingsSchema) {}
