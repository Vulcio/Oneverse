import { SearchWorksQuerySchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SearchWorksQueryDto extends zodDto(SearchWorksQuerySchema) {}
