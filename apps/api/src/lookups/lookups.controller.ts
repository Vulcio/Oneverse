import { Body, Controller, NotFoundException, Post, UseGuards } from "@nestjs/common";
import { RepeatsBackfillSchema } from "@oneverse/core";
import { zodDto } from "../common/zod-validation.js";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ArtistsService } from "../artists/artists.service.js";
import { ArtworkService } from "../artwork/artwork.service.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { LookupsService } from "./lookups.service.js";

/** A look at the library's repeated sections (issue #231), or with `apply`, the same and transposed ones linked. */
class RepeatsBackfillDto extends zodDto(RepeatsBackfillSchema) {}

/** The admin's backfills (issues #85, #86), started as background jobs (issue #92): their results show under Background jobs. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(GlobalAdminGuard)
export class LookupsController {
  constructor(
    private readonly lookups: LookupsService,
    private readonly artwork: ArtworkService,
    private readonly artists: ArtistsService,
  ) {}

  /** Finds artwork for up to 50 songs without an image. */
  @Post("artwork/backfill")
  async artworkBackfill() {
    if (!(await this.artwork.settings()).enabled) throw new NotFoundException("Artwork is turned off");
    return this.lookups.backfill("artwork-backfill");
  }

  /** Looks up to 25 artists nobody has asked about yet. */
  @Post("artists/backfill")
  async artistBackfill() {
    if (!(await this.artists.settings()).enabled) throw new NotFoundException("Artist pictures and bios are turned off");
    return this.lookups.backfill("artist-backfill");
  }

  /** Works out the words of songs saved before lyrics search (issue #221); queued by itself when the API starts with any left. */
  @Post("lyrics/backfill")
  lyricsBackfill() {
    return this.lookups.backfill("lyrics-backfill");
  }

  /** The library's repeated sections (issue #231): counted, or with `apply`, the same and transposed ones linked. */
  @Post("repeats/backfill")
  repeatsBackfill(@Body() dto: RepeatsBackfillDto) {
    return this.lookups.backfill("repeats-backfill", { apply: dto.apply ?? false });
  }
}
