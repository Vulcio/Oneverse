import { SaveStorageConfigSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SaveStorageConfigDto extends zodDto(SaveStorageConfigSchema) {}
