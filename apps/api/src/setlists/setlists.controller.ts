import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import {
  AddSetlistItemDto,
  CreateSetlistDto,
  ReorderSetlistItemsDto,
  SetArrangementDto,
  SetlistOfflineQueryDto,
  UpdateSetlistDto,
  UpdateSetlistItemDto,
} from "./dto/setlist.dto.js";
import { SetChartPreferencesDto } from "../arrangements/dto/arrangement.dto.js";
import { SetlistSharingService } from "./setlist-sharing.service.js";
import { SetlistsService } from "./setlists.service.js";
import { SongOwnershipService } from "./song-ownership.service.js";

/** Item-changing endpoints return the whole updated set, so the client never has to re-fetch. */
@ApiTags("setlists")
@ApiBearerAuth()
@Controller("setlists")
export class SetlistsController {
  constructor(
    private readonly setlists: SetlistsService,
    private readonly sharing: SetlistSharingService,
    private readonly ownership: SongOwnershipService,
  ) {}

  @Get()
  list(@SignedIn() user: AuthenticatedUser) {
    return this.setlists.list(user);
  }

  @Get("for-song/:songVersionId")
  @ApiOperation({
    summary: "The sets a song could go in",
    description:
      "Sets the user can change whose date isn't over (upcoming soonest first, then undated), each with `hasSong` (the song is in it already) and `canAddSong` (it may go in it: a team set takes the team's songs, songs in songbooks shared with the team and approved global ones). Issue #330.",
  })
  forSong(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    return this.setlists.forSong(user, songVersionId);
  }

  @Post()
  create(@SignedIn() user: AuthenticatedUser, @Body() dto: CreateSetlistDto) {
    return this.setlists.create(user, dto);
  }

  @Get(":setlistId")
  findOne(@SignedIn() user: AuthenticatedUser, @Param("setlistId") setlistId: string) {
    return this.setlists.findOne(user, setlistId);
  }

  @Patch(":setlistId")
  update(
    @SignedIn() user: AuthenticatedUser,
    @Param("setlistId") setlistId: string,
    @Body() dto: UpdateSetlistDto,
  ) {
    return this.setlists.update(user, setlistId, dto);
  }

  @Delete(":setlistId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@SignedIn() user: AuthenticatedUser, @Param("setlistId") setlistId: string): Promise<void> {
    return this.setlists.remove(user, setlistId);
  }

  @Get(":setlistId/song-candidates")
  candidates(
    @SignedIn() user: AuthenticatedUser,
    @Param("setlistId") setlistId: string,
    @Query("q") query: string | undefined,
  ) {
    return this.setlists.candidates(user, setlistId, query);
  }

  @Post(":setlistId/items")
  addItem(
    @SignedIn() user: AuthenticatedUser,
    @Param("setlistId") setlistId: string,
    @Body() dto: AddSetlistItemDto,
  ) {
    return this.setlists.addItem(user, setlistId, dto);
  }

  @Put(":setlistId/items/order")
  reorder(
    @SignedIn() user: AuthenticatedUser,
    @Param("setlistId") setlistId: string,
    @Body() dto: ReorderSetlistItemsDto,
  ) {
    return this.setlists.reorder(user, setlistId, dto.itemIds);
  }

  @Patch(":setlistId/items/:itemId")
  updateItem(
    @SignedIn() user: AuthenticatedUser,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateSetlistItemDto,
  ) {
    return this.setlists.updateItem(user, setlistId, itemId, dto);
  }

  @Delete(":setlistId/items/:itemId")
  removeItem(
    @SignedIn() user: AuthenticatedUser,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.setlists.removeItem(user, setlistId, itemId);
  }

  /**
   * The set and every song in it as the song view below gives it, in one
   * request: what a device keeps to play the set offline (issue #50,
   * docs/offline.md). The mobile app uses it too.
   */
  @Get(":setlistId/offline")
  @ApiOperation({
    summary: "A set to keep offline",
    description:
      "The set (as GET /setlists/:id returns it) and, for every item, its song view (as GET /setlists/:id/items/:itemId/song returns it): arrangement, the set's key, the viewer's chart preferences and notes. Only what the viewer can already read. A passage's verses only where its Bible may be kept offline - or, with for=screens, shown on screens.",
  })
  offlineCopy(@SignedIn() user: AuthenticatedUser, @Param("setlistId") setlistId: string, @Query() query: SetlistOfflineQueryDto) {
    return this.setlists.offlineCopy(user, setlistId, { passages: query.for === "screens" ? "screen" : "offline" });
  }

  /** One song of the set, readable by anyone who can open the set (guests included), with the viewer's private note. */
  @Get(":setlistId/items/:itemId/song")
  songView(
    @SignedIn() user: AuthenticatedUser,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.setlists.songView(user, setlistId, itemId);
  }

  /** Gives this song its own arrangement for this set, which the set then plays. */
  @Post(":setlistId/items/:itemId/set-arrangement")
  setArrangement(
    @SignedIn() user: AuthenticatedUser,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
    @Body() dto: SetArrangementDto,
  ) {
    return this.setlists.setArrangement(user, setlistId, itemId, dto.name);
  }

  /** The viewer's own chart preferences (hidden chords, simpler chords) for this song as the set plays it. */
  @Put(":setlistId/items/:itemId/chart-preferences")
  setMyChartPreferences(
    @SignedIn() user: AuthenticatedUser,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
    @Body() dto: SetChartPreferencesDto,
  ) {
    return this.setlists.setMyChartPreferences(user, setlistId, itemId, dto.preferences);
  }

  /** Asks the song's owner to hand it to the set's team (or hands it over, if it's yours). Returns the updated set. */
  @Post(":setlistId/items/:itemId/ownership-request")
  async requestOwnership(
    @SignedIn() user: AuthenticatedUser,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
  ) {
    await this.ownership.request(user, setlistId, itemId);
    return this.setlists.findOne(user, setlistId);
  }

  /** Share link and guests (editors only). */
  @Get(":setlistId/sharing")
  getSharing(@SignedIn() user: AuthenticatedUser, @Param("setlistId") setlistId: string) {
    return this.sharing.sharing(user, setlistId);
  }

  /** Turns the share link on, or replaces it (the old one stops working). */
  @Post(":setlistId/share-link")
  resetShareLink(@SignedIn() user: AuthenticatedUser, @Param("setlistId") setlistId: string) {
    return this.sharing.resetLink(user, setlistId);
  }

  @Delete(":setlistId/share-link")
  removeShareLink(@SignedIn() user: AuthenticatedUser, @Param("setlistId") setlistId: string) {
    return this.sharing.removeLink(user, setlistId);
  }

  @Delete(":setlistId/guests/:userId")
  removeGuest(
    @SignedIn() user: AuthenticatedUser,
    @Param("setlistId") setlistId: string,
    @Param("userId") guestUserId: string,
  ) {
    return this.sharing.removeGuest(user, setlistId, guestUserId);
  }

  /** A guest leaving a set shared with them. */
  @Post(":setlistId/leave")
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@SignedIn() user: AuthenticatedUser, @Param("setlistId") setlistId: string): Promise<void> {
    return this.sharing.leave(user, setlistId);
  }
}
