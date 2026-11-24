import { Body, Controller, Delete, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { LinkRelatedSongDto } from "./dto/link-related-song.dto.js";
import { WorksService } from "./works.service.js";

/** A song's related songs (issue #557): its original, its translations and adaptations - the songs of its Work. */
@ApiTags("song-versions")
@ApiBearerAuth()
@Controller("song-versions/:songVersionId/related")
export class RelatedSongsController {
  constructor(private readonly worksService: WorksService) {}

  /** Links another song to this one; answers this song's Work as GET /works/:id does. */
  @Post()
  link(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Body() dto: LinkRelatedSongDto): ReturnType<WorksService["linkRelated"]> {
    return this.worksService.linkRelated(user, songVersionId, dto.songVersionId, dto.relation);
  }

  /** Unlinks a related song: it becomes a song on its own again. */
  @Delete(":otherId")
  unlink(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Param("otherId") otherId: string): ReturnType<WorksService["unlinkRelated"]> {
    return this.worksService.unlinkRelated(user, songVersionId, otherId);
  }
}
