import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { SongbookOwnerGuard } from "../common/guards/songbook-owner.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AddSongbookEntryDto } from "./dto/add-songbook-entry.dto.js";
import { SongbookEntrySearchQueryDto } from "./dto/songbook-entry-search-query.dto.js";
import { CreateSongbookDto } from "./dto/create-songbook.dto.js";
import { ImportSongbookFromCatalogDto } from "./dto/import-songbook-from-catalog.dto.js";
import { SongbookResponseDto } from "./dto/songbook-response.dto.js";
import { UpdateSongbookDto } from "./dto/update-songbook.dto.js";
import { SongbooksService } from "./songbooks.service.js";

@ApiTags("songbooks")
@ApiBearerAuth()
@Controller("songbooks")
export class SongbooksController {
  constructor(private readonly songbooksService: SongbooksService) {}

  @Get()
  @ApiOkResponse({ type: SongbookResponseDto, isArray: true })
  findAll(@CurrentUser() user?: AuthenticatedUser): ReturnType<SongbooksService["findVisibleToUser"]> {
    if (!user) throw new UnauthorizedException();
    return this.songbooksService.findVisibleToUser(user);
  }

  @Post()
  @ApiCreatedResponse({ type: SongbookResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateSongbookDto,
  ): ReturnType<SongbooksService["create"]> {
    if (!user) throw new UnauthorizedException();
    return this.songbooksService.create(user, dto);
  }

  @Post("import-from-catalog")
  @ApiCreatedResponse({ type: SongbookResponseDto })
  importFromCatalog(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: ImportSongbookFromCatalogDto,
  ): ReturnType<SongbooksService["importFromCatalog"]> {
    if (!user) throw new UnauthorizedException();
    return this.songbooksService.importFromCatalog(user, dto);
  }

  /** A catalogue's entries already songs in the songbooks you can see started from it (issue #210). */
  @Get("from-catalog/:catalogId")
  catalogLibrary(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("catalogId") catalogId: string,
  ): ReturnType<SongbooksService["catalogLibrary"]> {
    if (!user) throw new UnauthorizedException();
    return this.songbooksService.catalogLibrary(user, catalogId);
  }

  @Get(":songbookId")
  @ApiOkResponse({ type: SongbookResponseDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("songbookId") songbookId: string,
  ): ReturnType<SongbooksService["findOne"]> {
    if (!user) throw new UnauthorizedException();
    return this.songbooksService.findOne(user, songbookId);
  }

  @Patch(":songbookId")
  @UseGuards(SongbookOwnerGuard)
  @ApiOkResponse({ type: SongbookResponseDto })
  update(
    @Param("songbookId") songbookId: string,
    @Body() dto: UpdateSongbookDto,
  ): ReturnType<SongbooksService["update"]> {
    return this.songbooksService.update(songbookId, dto);
  }

  /** Deleting it stays its owner's, not someone it's shared with to edit (issue #211). */
  @Delete(":songbookId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songbookId") songbookId: string): Promise<void> {
    if (!user) throw new UnauthorizedException();
    await this.songbooksService.assertOwns(user, songbookId);
    return this.songbooksService.remove(songbookId);
  }

  @Post(":songbookId/entries")
  @UseGuards(SongbookOwnerGuard)
  addEntry(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("songbookId") songbookId: string,
    @Body() dto: AddSongbookEntryDto,
  ): ReturnType<SongbooksService["addEntry"]> {
    if (!user) throw new UnauthorizedException();
    return this.songbooksService.addEntry(user, songbookId, dto);
  }

  @Delete(":songbookId/entries/:entryId")
  @UseGuards(SongbookOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeEntry(@Param("songbookId") songbookId: string, @Param("entryId") entryId: string): Promise<void> {
    return this.songbooksService.removeEntry(songbookId, entryId);
  }

  @Post(":songbookId/catalog-entries/:catalogEntryId/materialize")
  @UseGuards(SongbookOwnerGuard)
  materializeEntry(
    @Param("songbookId") songbookId: string,
    @Param("catalogEntryId") catalogEntryId: string,
  ): ReturnType<SongbooksService["materializeEntry"]> {
    return this.songbooksService.materializeEntry(songbookId, catalogEntryId);
  }
}

/** Songbook entries by reference, for search (issue #48). */
@ApiTags("songbooks")
@ApiBearerAuth()
@Controller("songbook-entries")
export class SongbookEntriesController {
  constructor(private readonly songbooksService: SongbooksService) {}

  @Get()
  @ApiOperation({
    summary: "Songbook entries by reference",
    description:
      'Reads `q` as a songbook reference - "HY 42", "HY42", "Hymns 42", "42", "A-17" - and returns matching entries in songbooks the user can see, whose songs they can see too (issue #213): exactly that number (up to 10), then numbers starting with it and numbers containing it (from two digits, up to 20 each), each marked by `match`. `more` gives more of each; `addableTo` (a set the user can change) only songs that can go in it. Empty when `q` has no number.',
  })
  search(@CurrentUser() user: AuthenticatedUser | undefined, @Query() query: SongbookEntrySearchQueryDto) {
    if (!user) throw new UnauthorizedException();
    return this.songbooksService.searchEntries(user, query.q, query.more ?? false, query.addableTo);
  }
}
