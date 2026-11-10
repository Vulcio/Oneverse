import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
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
  sync(@SignedIn() user: AuthenticatedUser, @Body() dto: OfflineSyncDto) {
    return this.offline.sync(user, dto);
  }

  @Get("pins")
  @ApiOperation({ summary: "The sets, songs and songbooks the user keeps offline on every device" })
  pins(@SignedIn() user: AuthenticatedUser) {
    return this.offline.listPins(user);
  }

  @Put("pins")
  @ApiOperation({ summary: "Keep a set, song or songbook offline (\"Available offline\", \"Keep a local copy\")" })
  pin(@SignedIn() user: AuthenticatedUser, @Body() dto: OfflinePinDto) {
    return this.offline.pin(user, dto);
  }

  @Delete("pins/:kind/:targetId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Stop keeping it offline" })
  unpin(
    @SignedIn() user: AuthenticatedUser,
    @Param("kind", new ParseEnumPipe(Object.fromEntries(PIN_KINDS.map((kind) => [kind, kind])))) kind: PinKind,
    @Param("targetId") targetId: string,
  ) {
    return this.offline.unpin(user, kind, targetId);
  }

  @Post("songs")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Several songs to keep offline (up to 100), each with its files' list and version; ones that can't be opened are left out" })
  songs(@SignedIn() user: AuthenticatedUser, @Body() dto: OfflineSongsDto) {
    return this.offline.songCopies(user, dto.ids);
  }

  @Get("songbooks/:songbookId")
  @ApiOperation({ summary: "A songbook to keep offline, with its entries and version" })
  songbook(@SignedIn() user: AuthenticatedUser, @Param("songbookId") songbookId: string) {
    return this.offline.songbookCopy(user, songbookId);
  }
}
