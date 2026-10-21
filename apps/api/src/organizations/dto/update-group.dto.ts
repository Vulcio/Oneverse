import { UpdateGroupSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class UpdateGroupDto extends zodDto(UpdateGroupSchema) {}
