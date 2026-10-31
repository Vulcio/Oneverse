import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CreateSongLinkSchema, UpdateSongLinkSchema } from "@oneverse/core";
import { AccessPolicyService } from "../access/access-policy.service.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { SongLinksService } from "./song-links.service.js";

class CreateSongLinkDto extends zodDto(CreateSongLinkSchema) {}
class UpdateSongLinkDto extends zodDto(UpdateSongLinkSchema) {}

/** A song's reference recordings (issue #346): anyone who sees the song adds their own. */
@ApiTags("song links")
@ApiBearerAuth()
@Controller("song-versions/:songVersionId/references")
export class SongLinksController {
  constructor(
    private readonly links: SongLinksService,
    private readonly access: AccessPolicyService,
  ) {}

  @Get()
  async list(@Param("songVersionId") songVersionId: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.links.list(user, songVersionId);
  }

  @Post()
  async create(@Param("songVersionId") songVersionId: string, @Body() dto: CreateSongLinkDto, @CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.links.create(user, songVersionId, dto);
  }

  @Patch(":linkId")
  async update(@Param("songVersionId") songVersionId: string, @Param("linkId") linkId: string, @Body() dto: UpdateSongLinkDto, @CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    return this.links.update(user, songVersionId, linkId, dto);
  }

  @Delete(":linkId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("songVersionId") songVersionId: string, @Param("linkId") linkId: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    await this.access.assertCanSeeSong(user, songVersionId);
    await this.links.remove(user, songVersionId, linkId);
  }
}
