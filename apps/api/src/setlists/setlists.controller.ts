import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
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

export function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}

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
  list(@CurrentUser() user: AuthenticatedUser | undefined) {
    return this.setlists.list(requireUser(user));
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateSetlistDto) {
    return this.setlists.create(requireUser(user), dto);
  }

  @Get(":setlistId")
  findOne(@CurrentUser() user: AuthenticatedUser | undefined, @Param("setlistId") setlistId: string) {
    return this.setlists.findOne(requireUser(user), setlistId);
  }

  @Patch(":setlistId")
  update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("setlistId") setlistId: string,
    @Body() dto: UpdateSetlistDto,
  ) {
    return this.setlists.update(requireUser(user), setlistId, dto);
  }

  @Delete(":setlistId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser | undefined, @Param("setlistId") setlistId: string): Promise<void> {
    return this.setlists.remove(requireUser(user), setlistId);
  }

  @Get(":setlistId/song-candidates")
  candidates(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("setlistId") setlistId: string,
    @Query("q") query: string | undefined,
  ) {
    return this.setlists.candidates(requireUser(user), setlistId, query);
  }

  @Post(":setlistId/items")
  addItem(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("setlistId") setlistId: string,
    @Body() dto: AddSetlistItemDto,
  ) {
    return this.setlists.addItem(requireUser(user), setlistId, dto);
  }

  @Put(":setlistId/items/order")
  reorder(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("setlistId") setlistId: string,
    @Body() dto: ReorderSetlistItemsDto,
  ) {
    return this.setlists.reorder(requireUser(user), setlistId, dto.itemIds);
  }

  @Patch(":setlistId/items/:itemId")
  updateItem(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateSetlistItemDto,
  ) {
    return this.setlists.updateItem(requireUser(user), setlistId, itemId, dto);
  }

  @Delete(":setlistId/items/:itemId")
  removeItem(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.setlists.removeItem(requireUser(user), setlistId, itemId);
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
  offlineCopy(@CurrentUser() user: AuthenticatedUser | undefined, @Param("setlistId") setlistId: string, @Query() query: SetlistOfflineQueryDto) {
    return this.setlists.offlineCopy(requireUser(user), setlistId, { passages: query.for === "screens" ? "screen" : "offline" });
  }

  /** One song of the set, readable by anyone who can open the set (guests included), with the viewer's private note. */
  @Get(":setlistId/items/:itemId/song")
  songView(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.setlists.songView(requireUser(user), setlistId, itemId);
  }

  /** Gives this song its own arrangement for this set, which the set then plays. */
  @Post(":setlistId/items/:itemId/set-arrangement")
  setArrangement(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
    @Body() dto: SetArrangementDto,
  ) {
    return this.setlists.setArrangement(requireUser(user), setlistId, itemId, dto.name);
  }

  /** The viewer's own chart preferences (hidden chords, simpler chords) for this song as the set plays it. */
  @Put(":setlistId/items/:itemId/chart-preferences")
  setMyChartPreferences(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
    @Body() dto: SetChartPreferencesDto,
  ) {
    return this.setlists.setMyChartPreferences(requireUser(user), setlistId, itemId, dto.preferences);
  }

  /** Asks the song's owner to hand it to the set's team (or hands it over, if it's yours). Returns the updated set. */
  @Post(":setlistId/items/:itemId/ownership-request")
  async requestOwnership(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("setlistId") setlistId: string,
    @Param("itemId") itemId: string,
  ) {
    await this.ownership.request(requireUser(user), setlistId, itemId);
    return this.setlists.findOne(requireUser(user), setlistId);
  }

  /** Share link and guests (editors only). */
  @Get(":setlistId/sharing")
  getSharing(@CurrentUser() user: AuthenticatedUser | undefined, @Param("setlistId") setlistId: string) {
    return this.sharing.sharing(requireUser(user), setlistId);
  }

  /** Turns the share link on, or replaces it (the old one stops working). */
  @Post(":setlistId/share-link")
  resetShareLink(@CurrentUser() user: AuthenticatedUser | undefined, @Param("setlistId") setlistId: string) {
    return this.sharing.resetLink(requireUser(user), setlistId);
  }

  @Delete(":setlistId/share-link")
  removeShareLink(@CurrentUser() user: AuthenticatedUser | undefined, @Param("setlistId") setlistId: string) {
    return this.sharing.removeLink(requireUser(user), setlistId);
  }

  @Delete(":setlistId/guests/:userId")
  removeGuest(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("setlistId") setlistId: string,
    @Param("userId") guestUserId: string,
  ) {
    return this.sharing.removeGuest(requireUser(user), setlistId, guestUserId);
  }

  /** A guest leaving a set shared with them. */
  @Post(":setlistId/leave")
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@CurrentUser() user: AuthenticatedUser | undefined, @Param("setlistId") setlistId: string): Promise<void> {
    return this.sharing.leave(requireUser(user), setlistId);
  }
}
