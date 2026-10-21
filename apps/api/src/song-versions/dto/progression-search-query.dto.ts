import { ProgressionSearchQuerySchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class ProgressionSearchQueryDto extends zodDto(ProgressionSearchQuerySchema) {}
