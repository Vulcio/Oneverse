import { ListTeamsQuerySchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class ListTeamsQueryDto extends zodDto(ListTeamsQuerySchema) {}
