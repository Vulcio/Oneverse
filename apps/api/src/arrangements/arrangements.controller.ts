import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { ArrangementsService } from "./arrangements.service.js";
import { ChartPreferencesDto, CreateArrangementDto, UpdateArrangementDto } from "./dto/arrangement.dto.js";

/** Arrangements of a song, and a player's own chart preferences (docs/arrangement-document-v2.md). */
@ApiTags("arrangements")
@ApiBearerAuth()
@Controller()
export class ArrangementsController {
  constructor(private readonly arrangements: ArrangementsService) {}

  @Get("song-versions/:songVersionId/arrangements")
  list(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    return this.arrangements.listForSong(user, songVersionId);
  }

  @Post("song-versions/:songVersionId/arrangements")
  create(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Body() dto: CreateArrangementDto) {
    return this.arrangements.create(user, songVersionId, dto);
  }

  @Get("arrangements/:id")
  findOne(@SignedIn() user: AuthenticatedUser, @Param("id") id: string) {
    return this.arrangements.findOne(user, id);
  }

  @Patch("arrangements/:id")
  update(@SignedIn() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateArrangementDto) {
    return this.arrangements.update(user, id, dto);
  }

  @Post("arrangements/:id/reviewed")
  markReviewed(@SignedIn() user: AuthenticatedUser, @Param("id") id: string) {
    return this.arrangements.markReviewed(user, id);
  }

  @Delete("arrangements/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@SignedIn() user: AuthenticatedUser, @Param("id") id: string): Promise<void> {
    return this.arrangements.remove(user, id);
  }

  @Get("chart-preferences")
  preferences(
    @SignedIn() user: AuthenticatedUser,
    @Query("songVersionId") songVersionId: string,
    @Query("arrangementId") arrangementId?: string,
  ) {
    return this.arrangements.preferencesForSong(user, songVersionId, arrangementId || null);
  }

  @Put("chart-preferences")
  savePreferences(@SignedIn() user: AuthenticatedUser, @Body() dto: ChartPreferencesDto) {
    return this.arrangements.savePreferencesForSong(user, dto.songVersionId, dto.arrangementId ?? null, dto.preferences);
  }
}
