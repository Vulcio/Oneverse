import { CreateSuggestionSchema, ReviewSuggestionSchema, ListSuggestionsQuerySchema } from "@oneverse/core";
import { zodDto } from "../common/zod-validation.js";

export class CreateSuggestionDto extends zodDto(CreateSuggestionSchema) {}

export class ReviewSuggestionDto extends zodDto(ReviewSuggestionSchema) {}

export class ListSuggestionsQueryDto extends zodDto(ListSuggestionsQuerySchema) {}
