import { TeamPositionSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class TeamPositionDto extends zodDto(TeamPositionSchema) {}
