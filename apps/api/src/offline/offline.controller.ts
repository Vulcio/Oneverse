import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { requireUser } from "../setlists/setlists.controller.js";
import { OfflinePinDto, OfflineSongsDto, OfflineSyncDto, PIN_KINDS, type PinKind } from "./dto/offline.dto.js";
import { OfflineService } from "./offline.service.js";

/** What a user's devices keep offline, and keeping it current (docs/offline.md); the mobile app uses it too. */
@ApiTags("offline")
@ApiBearerAuth()
@Controller("offline")
export class OfflineController {
  constructor(private readonly offline: OfflineService) {}

  @Post("sync")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "What a device should keep offline now",
    description:
      "Send what the device keeps - sets (`known`), songs (`knownSongs`), songbooks (`knownSongbooks`) - with their versions. Each list comes back with the current versions and, only where the device's is out of date, the full copy; what the device should remove (deleted, no longer visible, unpinned) is in `gone`, `goneSongs` and `goneSongbooks`. Sets: dated from yesterday to `days` ahead (default 14), pinned, or already kept. Songbooks: pinned. Songs: the user's own, pinned, or in a kept set or songbook; `audio` says whether to download their audio files. Also returns the user's pins and chord settings (`viewer`). With a `fingerprint` (offlineFingerprint() in @oneverse/core, of what the device keeps) and `known` (its sets), the answer is only `unchanged: true` (with `days`, `upcoming`, `pins` and `viewer`) or `unchanged: false`, when the device then syncs with its lists (issue #121).",
  })
  sync(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: OfflineSyncDto) {
    return this.offline.sync(requireUser(user), dto);
  }

  @Get("pins")
  @ApiOperation({ summary: "The sets, songs and songbooks the user keeps offline on every device" })
  pins(@CurrentUser() user: AuthenticatedUser | undefined) {
    return this.offline.listPins(requireUser(user));
  }

  @Put("pins")
  @ApiOperation({ summary: "Keep a set, song or songbook offline (\"Available offline\", \"Keep a local copy\")" })
  pin(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: OfflinePinDto) {
    return this.offline.pin(requireUser(user), dto);
  }

  @Delete("pins/:kind/:targetId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Stop keeping it offline" })
  unpin(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("kind", new ParseEnumPipe(Object.fromEntries(PIN_KINDS.map((kind) => [kind, kind])))) kind: PinKind,
    @Param("targetId") targetId: string,
  ) {
    return this.offline.unpin(requireUser(user), kind, targetId);
  }

  @Post("songs")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Several songs to keep offline (up to 100), each with its files' list and version; ones that can't be opened are left out" })
  songs(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: OfflineSongsDto) {
    return this.offline.songCopies(requireUser(user), dto.ids);
  }

  @Get("songbooks/:songbookId")
  @ApiOperation({ summary: "A songbook to keep offline, with its entries and version" })
  songbook(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songbookId") songbookId: string) {
    return this.offline.songbookCopy(requireUser(user), songbookId);
  }
}
