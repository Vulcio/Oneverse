import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { StreamingIdentifierType } from "@oneverse/core";
import { AccessPolicyService } from "../access/access-policy.service.js";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import { SongVersionEditorGuard } from "../common/guards/song-version-editor.guard.js";
import { LookupsService } from "../lookups/lookups.service.js";
import { SongBinService } from "./song-bin.service.js";
import { SongVersionOwnerGuard } from "../common/guards/song-version-owner.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { LinkMetadataDto } from "./dto/link-metadata.dto.js";
import { CreateSongVersionDto } from "./dto/create-song-version.dto.js";
import { ListSongVersionsQueryDto } from "./dto/list-song-versions-query.dto.js";
import { SetStreamingLinkDto } from "./dto/set-streaming-link.dto.js";
import { SongVersionResponseDto, SongVersionSongbookMembershipDto } from "./dto/song-version-response.dto.js";
import { LinkRepeatsDto, UpdateSongVersionDto } from "./dto/update-song-version.dto.js";
import { SongHistoryService } from "./song-history.service.js";
import { SongRepeatsService } from "./song-repeats.service.js";
import { SongVersionsService } from "./song-versions.service.js";
import { RateLimit } from "../security/rate-limit.decorator.js";

const STREAMING_TYPES = new Set(["SPOTIFY", "APPLE_MUSIC", "DEEZER", "YOUTUBE"]);

function asStreamingType(type: string): StreamingIdentifierType {
  if (!STREAMING_TYPES.has(type)) {
    throw new BadRequestException(`Unknown link type '${type}' — expected one of ${[...STREAMING_TYPES].join(", ")}`);
  }
  return type as StreamingIdentifierType;
}

@ApiTags("song-versions")
@ApiBearerAuth()
@Controller("song-versions")
export class SongVersionsController {
  constructor(
    private readonly songVersionsService: SongVersionsService,
    private readonly access: AccessPolicyService,
    private readonly history: SongHistoryService,
    private readonly repeats: SongRepeatsService,
    private readonly lookups: LookupsService,
    private readonly bin: SongBinService,
  ) {}

  @Get()
  findAll(
    @SignedIn() user: AuthenticatedUser,
    @Query() query: ListSongVersionsQueryDto,
  ): ReturnType<SongVersionsService["findVisibleToUser"]> {
    return this.songVersionsService.findVisibleToUser(user, query);
  }

  /** How many songs and artists you can see. */
  @Get("stats")
  stats(@SignedIn() user: AuthenticatedUser): ReturnType<SongVersionsService["statsForUser"]> {
    return this.songVersionsService.statsForUser(user);
  }

  /** The artists of the songs you can see, with how many songs each (issue #58). */
  @Get("artists")
  artists(@SignedIn() user: AuthenticatedUser, @Query("q") query: string | undefined): ReturnType<SongVersionsService["artistsForUser"]> {
    return this.songVersionsService.artistsForUser(user, query ?? "");
  }

  /** Names already credited on songs you can see, for autocomplete. */
  @Get("credits")
  searchCredits(
    @SignedIn() user: AuthenticatedUser,
    @Query("q") query: string | undefined,
  ): ReturnType<SongVersionsService["searchCredits"]> {
    return this.songVersionsService.searchCredits(user, query ?? "");
  }

  /** Songs you can see with this title, grouped with their other versions. */
  @Get("matches")
  findMatches(
    @SignedIn() user: AuthenticatedUser,
    @Query("title") title: string | undefined,
  ): ReturnType<SongVersionsService["findMatches"]> {
    return this.songVersionsService.findMatches(user, title ?? "");
  }

  /** The songs before and after this one in a list of the library (issue #84), and where it is in it. */
  @Get(":songVersionId/neighbors")
  async neighbors(
    @SignedIn() user: AuthenticatedUser,
    @Param("songVersionId") songVersionId: string,
    @Query() query: ListSongVersionsQueryDto,
  ): ReturnType<SongVersionsService["neighbors"]> {
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.songVersionsService.neighbors(user, songVersionId, query);
  }

  @Get(":songVersionId")
  @ApiOkResponse({ type: SongVersionResponseDto })
  findOne(
    @SignedIn() user: AuthenticatedUser,
    @Param("songVersionId") songVersionId: string,
  ): ReturnType<SongVersionsService["findOne"]> {
    return this.songVersionsService.findOne(user, songVersionId);
  }

  @Get(":songVersionId/songbooks")
  @ApiOkResponse({ type: SongVersionSongbookMembershipDto, isArray: true })
  async findSongbookMemberships(
    @SignedIn() user: AuthenticatedUser,
    @Param("songVersionId") songVersionId: string,
  ): ReturnType<SongVersionsService["findSongbookMemberships"]> {
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.songVersionsService.findSongbookMemberships(user, songVersionId);
  }

  @Post()
  @ApiCreatedResponse({ type: SongVersionResponseDto })
  async create(
    @SignedIn() user: AuthenticatedUser,
    @Body() dto: CreateSongVersionDto,
  ): ReturnType<SongVersionsService["create"]> {
    const created = await this.songVersionsService.create(user, dto);
    // Its artwork (issue #85) and its artists' pictures and bios (issue #86), found by the Worker (issue #92): the song doesn't wait.
    await this.lookups.songArtwork(created.id);
    await this.lookups.artists(dto.artists);
    return created;
  }

  @Patch(":songVersionId")
  @UseGuards(SongVersionEditorGuard)
  @ApiOkResponse({ type: SongVersionResponseDto })
  async update(
    @SignedIn() user: AuthenticatedUser,
    @Param("songVersionId") songVersionId: string,
    @Body() dto: UpdateSongVersionDto,
  ): ReturnType<SongVersionsService["update"]> {
    const updated = await this.songVersionsService.update(user, songVersionId, dto);
    if (dto.artists?.length) await this.lookups.artists(dto.artists);
    return updated;
  }

  /** Its sections that repeat an earlier one (issue #231), for its editors to link. */
  @Get(":songVersionId/repeats")
  @UseGuards(SongVersionEditorGuard)
  listRepeats(@Param("songVersionId") songVersionId: string): ReturnType<SongRepeatsService["list"]> {
    return this.repeats.list(songVersionId);
  }

  /** Repeats linked: passes of the sections they repeat; kept in its history. */
  @Post(":songVersionId/repeats")
  @UseGuards(SongVersionEditorGuard)
  linkRepeats(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Body() dto: LinkRepeatsDto): ReturnType<SongRepeatsService["link"]> {
    return this.repeats.link(songVersionId, user.id, { revision: dto.revision, sectionIds: dto.sectionIds });
  }

  @Delete(":songVersionId")
  @UseGuards(SongVersionOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    // Into the bin (issue #340), for BIN_DAYS: SongBinController puts it back or deletes it for good.
    return this.bin.bin(user, songVersionId);
  }

  /** The song's history, newest first (issue #71). */
  @Get(":songVersionId/history")
  async listHistory(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string): ReturnType<SongHistoryService["list"]> {
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.history.list(songVersionId);
  }

  @Get(":songVersionId/history/:revisionId")
  async getRevision(
    @SignedIn() user: AuthenticatedUser,
    @Param("songVersionId") songVersionId: string,
    @Param("revisionId") revisionId: string,
  ): ReturnType<SongHistoryService["detail"]> {
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.history.detail(songVersionId, revisionId);
  }

  /** Puts the song back as that entry left it, as a new save. */
  @Post(":songVersionId/history/:revisionId/restore")
  @UseGuards(SongVersionEditorGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SongVersionResponseDto })
  restore(
    @SignedIn() user: AuthenticatedUser,
    @Param("songVersionId") songVersionId: string,
    @Param("revisionId") revisionId: string,
  ): ReturnType<SongVersionsService["restore"]> {
    return this.songVersionsService.restore(user, songVersionId, revisionId);
  }

  @Get(":songVersionId/chordpro")
  async exportChordPro(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    await this.access.assertCanSeeSong(user, songVersionId);
    return { content: await this.songVersionsService.exportChordPro(songVersionId) };
  }

  @Put(":songVersionId/links/:type")
  @UseGuards(SongVersionOwnerGuard)
  setStreamingLink(
    @Param("songVersionId") songVersionId: string,
    @Param("type") type: string,
    @Body() dto: SetStreamingLinkDto,
  ) {
    return this.songVersionsService.setStreamingLink(songVersionId, asStreamingType(type), dto.url);
  }

  @Delete(":songVersionId/links/:type")
  @UseGuards(SongVersionOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeStreamingLink(@Param("songVersionId") songVersionId: string, @Param("type") type: string) {
    return this.songVersionsService.removeStreamingLink(songVersionId, asStreamingType(type));
  }

  /** Links the song info chosen in Auto detect (issue #22). */
  @RateLimit("heavy")
  @Post(":songVersionId/metadata-link")
  @UseGuards(SongVersionOwnerGuard)
  linkMetadata(@Param("songVersionId") songVersionId: string, @Body() dto: LinkMetadataDto) {
    return this.songVersionsService.linkMetadata(songVersionId, dto.sources, { artwork: dto.artwork ?? true });
  }

  @Delete(":songVersionId/metadata-link")
  @UseGuards(SongVersionOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  unlinkMetadata(@Param("songVersionId") songVersionId: string) {
    return this.songVersionsService.unlinkMetadata(songVersionId);
  }

  @Get(":songVersionId/metadata")
  async getMetadata(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.songVersionsService.getMetadataMatch(songVersionId);
  }
}
