import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AccessPolicyService } from "../access/access-policy.service.js";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { LibraryHomeService } from "./library-home.service.js";

/** The Library's home, favorites and views (issue #81). */
@ApiTags("library")
@ApiBearerAuth()
@Controller()
export class LibraryHomeController {
  constructor(
    private readonly home: LibraryHomeService,
    private readonly access: AccessPolicyService,
  ) {}

  /** The shelves: newly added, recently viewed, favorites, popular in your teams. */
  @Get("library/home")
  get(@SignedIn() user: AuthenticatedUser) {
    return this.home.home(user);
  }

  /** The user opened the song. */
  @Post("song-versions/:songVersionId/views")
  @HttpCode(HttpStatus.NO_CONTENT)
  async view(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    const me = user;
    await this.access.assertCanSeeSong(me, songVersionId);
    await this.home.view(me, songVersionId);
  }

  @Put("song-versions/:songVersionId/favorite")
  @HttpCode(HttpStatus.NO_CONTENT)
  async favorite(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    const me = user;
    await this.access.assertCanSeeSong(me, songVersionId);
    await this.home.favorite(me, songVersionId, true);
  }

  @Delete("song-versions/:songVersionId/favorite")
  @HttpCode(HttpStatus.NO_CONTENT)
  async unfavorite(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    await this.home.favorite(user, songVersionId, false);
  }
}
