import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { CreateSuggestionDto, ListSuggestionsQueryDto, ReviewSuggestionDto } from "./suggestions.dto.js";
import { SuggestionsService } from "./suggestions.service.js";

/** Suggested changes to catalogue songs (issue #74). */
@ApiTags("suggestions")
@ApiBearerAuth()
@Controller()
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Post("song-versions/:songVersionId/suggestions")
  create(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Body() dto: CreateSuggestionDto) {
    return this.suggestions.create(user, songVersionId, dto);
  }

  /** Your own suggestions on this song. */
  @Get("song-versions/:songVersionId/suggestions")
  forSong(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    return this.suggestions.mine(user, songVersionId);
  }

  @Get("suggestions")
  list(@SignedIn() user: AuthenticatedUser, @Query() query: ListSuggestionsQueryDto) {
    return this.suggestions.list(user, query.state ?? "open");
  }

  @Get("suggestions/mine")
  mine(@SignedIn() user: AuthenticatedUser) {
    return this.suggestions.mine(user);
  }

  @Get("suggestions/:id")
  findOne(@SignedIn() user: AuthenticatedUser, @Param("id") id: string) {
    return this.suggestions.findOne(user, id);
  }

  @Post("suggestions/:id/accept")
  @HttpCode(HttpStatus.OK)
  accept(@SignedIn() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: ReviewSuggestionDto) {
    return this.suggestions.accept(user, id, dto.notes);
  }

  @Post("suggestions/:id/decline")
  @HttpCode(HttpStatus.OK)
  decline(@SignedIn() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: ReviewSuggestionDto) {
    return this.suggestions.decline(user, id, dto.notes);
  }

  @Post("suggestions/:id/withdraw")
  @HttpCode(HttpStatus.OK)
  withdraw(@SignedIn() user: AuthenticatedUser, @Param("id") id: string) {
    return this.suggestions.withdraw(user, id);
  }
}
