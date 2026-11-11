import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { LinkMusicBrainzDto } from "../musicbrainz/dto/link-musicbrainz.dto.js";
import { WorksService } from "./works.service.js";

@ApiTags("works")
@ApiBearerAuth()
@Controller("works")
export class WorksController {
  constructor(private readonly worksService: WorksService) {}

  @Get(":workId")
  findOne(@SignedIn() user: AuthenticatedUser, @Param("workId") workId: string): ReturnType<WorksService["findOne"]> {
    return this.worksService.findOne(user, workId);
  }

  @Post(":workId/musicbrainz-link")
  linkMusicBrainz(
    @Param("workId") workId: string,
    @SignedIn() user: AuthenticatedUser,
    @Body() dto: LinkMusicBrainzDto,
  ) {
    return this.worksService.linkMusicBrainzWork(workId, user, dto.mbid);
  }

  @Delete(":workId/musicbrainz-link")
  @HttpCode(HttpStatus.NO_CONTENT)
  unlinkMusicBrainz(@Param("workId") workId: string, @SignedIn() user: AuthenticatedUser) {
    return this.worksService.unlinkMusicBrainzWork(workId, user);
  }

  @Get(":workId/musicbrainz")
  getMusicBrainz(@SignedIn() user: AuthenticatedUser, @Param("workId") workId: string) {
    return this.worksService.getMusicBrainzInfo(user, workId);
  }
}
