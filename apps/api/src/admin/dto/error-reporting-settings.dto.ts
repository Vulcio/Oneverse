import { SaveErrorReportingSettingsSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SaveErrorReportingSettingsDto extends zodDto(SaveErrorReportingSettingsSchema) {}
