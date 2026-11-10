import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
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
  findAll(@SignedIn() user: AuthenticatedUser): ReturnType<SongbooksService["findVisibleToUser"]> {
    return this.songbooksService.findVisibleToUser(user);
  }

  @Post()
  @ApiCreatedResponse({ type: SongbookResponseDto })
  create(
    @SignedIn() user: AuthenticatedUser,
    @Body() dto: CreateSongbookDto,
  ): ReturnType<SongbooksService["create"]> {
    return this.songbooksService.create(user, dto);
  }

  @Post("import-from-catalog")
  @ApiCreatedResponse({ type: SongbookResponseDto })
  importFromCatalog(
    @SignedIn() user: AuthenticatedUser,
    @Body() dto: ImportSongbookFromCatalogDto,
  ): ReturnType<SongbooksService["importFromCatalog"]> {
    return this.songbooksService.importFromCatalog(user, dto);
  }

  /** A catalogue's entries already songs in the songbooks you can see started from it (issue #210). */
  @Get("from-catalog/:catalogId")
  catalogLibrary(
    @SignedIn() user: AuthenticatedUser,
    @Param("catalogId") catalogId: string,
  ): ReturnType<SongbooksService["catalogLibrary"]> {
    return this.songbooksService.catalogLibrary(user, catalogId);
  }

  @Get(":songbookId")
  @ApiOkResponse({ type: SongbookResponseDto })
  findOne(
    @SignedIn() user: AuthenticatedUser,
    @Param("songbookId") songbookId: string,
  ): ReturnType<SongbooksService["findOne"]> {
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
  async remove(@SignedIn() user: AuthenticatedUser, @Param("songbookId") songbookId: string): Promise<void> {
    await this.songbooksService.assertOwns(user, songbookId);
    return this.songbooksService.remove(songbookId);
  }

  @Post(":songbookId/entries")
  @UseGuards(SongbookOwnerGuard)
  addEntry(
    @SignedIn() user: AuthenticatedUser,
    @Param("songbookId") songbookId: string,
    @Body() dto: AddSongbookEntryDto,
  ): ReturnType<SongbooksService["addEntry"]> {
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
  search(@SignedIn() user: AuthenticatedUser, @Query() query: SongbookEntrySearchQueryDto) {
    return this.songbooksService.searchEntries(user, query.q, query.more ?? false, query.addableTo);
  }
}
