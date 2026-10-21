import { CreateSmartListSchema, UpdateSmartListSchema } from "@oneverse/core";
import { zodDto } from "../common/zod-validation.js";

export class CreateSmartListDto extends zodDto(CreateSmartListSchema) {}

export class UpdateSmartListDto extends zodDto(UpdateSmartListSchema) {}
