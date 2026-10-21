import { SaveAuthConfigSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SaveAuthConfigDto extends zodDto(SaveAuthConfigSchema) {}
