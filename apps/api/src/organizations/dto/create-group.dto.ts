import { CreateGroupSchema } from "@songverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class CreateGroupDto extends zodDto(CreateGroupSchema) {}
