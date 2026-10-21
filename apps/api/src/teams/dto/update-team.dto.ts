import { UpdateTeamSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class UpdateTeamDto extends zodDto(UpdateTeamSchema) {}
