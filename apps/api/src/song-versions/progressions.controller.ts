import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { ProgressionSearchQueryDto } from "./dto/progression-search-query.dto.js";
import { SongVersionsService } from "./song-versions.service.js";

/** Songs by chord progression (issue #204): searched, and alike. */
@ApiTags("progressions")
@ApiBearerAuth()
@Controller("progressions")
export class ProgressionsController {
  constructor(private readonly songs: SongVersionsService) {}

  /** The songs you can see whose chords go like `q` ("1 5 6m 4", "I V vi IV"), in any key. */
  @Get("search")
  search(@SignedIn() user: AuthenticatedUser, @Query() query: ProgressionSearchQueryDto): ReturnType<SongVersionsService["searchProgressions"]> {
    return this.songs.searchProgressions(user, query.q);
  }

  /** A song's progressions, and the songs you can see that move most like it. */
  @Get("songs/:songVersionId")
  ofSong(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string): ReturnType<SongVersionsService["progressionsOf"]> {
    return this.songs.progressionsOf(user, songVersionId);
  }
}
