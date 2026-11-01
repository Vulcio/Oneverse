import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ChordContentQuerySchema, ChordSearchQuerySchema } from "@oneverse/core";
import { zodDto } from "../common/zod-validation.js";
import { SongProviderService } from "../plugins/song-provider/song-provider.service.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { FindChordsService } from "./find-chords.service.js";

export class ChordSearchQueryDto extends zodDto(ChordSearchQuerySchema) {}
export class ChordContentQueryDto extends zodDto(ChordContentQuerySchema) {}

/** The plugins' hooks people use (issues #157, #369): Find chords, at the Song provider plugin's servers. Read only. */
@ApiTags("plugins")
@ApiBearerAuth()
@Controller("plugins")
export class FindChordsController {
  constructor(
    private readonly songProviders: SongProviderService,
    private readonly findChords: FindChordsService,
  ) {}

  /** Whether Find chords has anywhere to look. */
  @Get("chords")
  chordsAvailable() {
    return this.songProviders.chordsAvailable();
  }

  @Get("chords/search")
  @RateLimit("heavy")
  searchChords(@Query() query: ChordSearchQueryDto) {
    return this.findChords.search(query.title, query.artist, query.language);
  }

  /** A song's chart: `?version=` one of its versions, or its default one. */
  @Get("chords/:providerId/songs/:songId")
  @RateLimit("heavy")
  chordContent(@Param("providerId") providerId: string, @Param("songId") songId: string, @Query() query: ChordContentQueryDto) {
    if (!songId.trim() || songId.length > 200) throw new BadRequestException(["songId must be at most 200 characters"]);
    return this.songProviders.chordContent(providerId, songId, query.version);
  }
}
