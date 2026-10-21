import { SearchRecordingsQuerySchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SearchRecordingsQueryDto extends zodDto(SearchRecordingsQuerySchema) {}
