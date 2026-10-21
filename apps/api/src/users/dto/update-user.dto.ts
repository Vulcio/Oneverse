import { UpdateUserSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class UpdateUserDto extends zodDto(UpdateUserSchema) {}
