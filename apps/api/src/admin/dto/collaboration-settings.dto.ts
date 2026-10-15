import { SaveCollaborationSettingsSchema } from "@songverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SaveCollaborationSettingsDto extends zodDto(SaveCollaborationSettingsSchema) {}
