import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { ConnectionRequestDto, ShareDto } from "./people.dto.js";
import { PeopleService } from "./people.service.js";

/** People, and sharing songs with them (issue #77). */
@ApiTags("people")
@ApiBearerAuth()
@Controller()
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get("people")
  list(@SignedIn() user: AuthenticatedUser) {
    return this.people.list(user);
  }

  @Post("people/requests")
  request(@SignedIn() user: AuthenticatedUser, @Body() dto: ConnectionRequestDto) {
    return this.people.request(user, dto);
  }

  @Post("people/requests/:id/accept")
  @HttpCode(HttpStatus.NO_CONTENT)
  accept(@SignedIn() user: AuthenticatedUser, @Param("id") id: string) {
    return this.people.answer(user, id, true);
  }

  @Post("people/requests/:id/decline")
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(@SignedIn() user: AuthenticatedUser, @Param("id") id: string) {
    return this.people.answer(user, id, false);
  }

  @Delete("people/requests/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(@SignedIn() user: AuthenticatedUser, @Param("id") id: string) {
    return this.people.cancel(user, id);
  }

  @Delete("people/:userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@SignedIn() user: AuthenticatedUser, @Param("userId") userId: string) {
    return this.people.remove(user, userId);
  }

  /** Who the song is shared with (who manages it). */
  @Get("song-versions/:songVersionId/shares")
  async shares(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    await this.people.assertManages(user, songVersionId);
    return this.people.shares(songVersionId);
  }

  @Put("song-versions/:songVersionId/shares/:userId")
  async share(
    @SignedIn() user: AuthenticatedUser,
    @Param("songVersionId") songVersionId: string,
    @Param("userId") userId: string,
    @Body() dto: ShareDto,
  ) {
    const me = user;
    await this.people.assertManages(me, songVersionId);
    return this.people.share(me, songVersionId, userId, dto.canEdit);
  }

  /** Stops sharing it with someone; `me`: someone it's shared with takes it out of their library. */
  @Delete("song-versions/:songVersionId/shares/:userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async unshare(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Param("userId") userId: string) {
    const me = user;
    if (userId === "me" || userId === me.id) {
      await this.people.leave(me, songVersionId);
      return;
    }
    await this.people.assertManages(me, songVersionId);
    await this.people.unshare(songVersionId, userId);
  }
}
