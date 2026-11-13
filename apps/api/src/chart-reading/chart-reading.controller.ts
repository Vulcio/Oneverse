import { BadRequestException, Controller, Get, Param, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { ChartReading } from "@oneverse/core";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { SongFileInterceptor } from "../uploads/song-file.interceptor.js";
import { ChartReadingService } from "./chart-reading.service.js";

/**
 * A PDF's or a picture's chart read by the server (issue #124), when the
 * device couldn't read it: started here, read by the Worker, followed by
 * its id. Anyone signed in, for the song they're making.
 */
@ApiTags("chart-reading")
@ApiBearerAuth()
@Controller("chart-reading")
export class ChartReadingController {
  constructor(private readonly chartReading: ChartReadingService) {}

  @RateLimit("heavy")
  @Post()
  @UseInterceptors(SongFileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  start(@UploadedFile() file: Express.Multer.File | undefined, @SignedIn() user: AuthenticatedUser): Promise<{ id: string }> {
    if (!file) throw new BadRequestException(["file must be sent"]);
    return this.chartReading.start(user.id, file);
  }

  @Get(":id")
  get(@Param("id") id: string, @SignedIn() user: AuthenticatedUser): Promise<ChartReading> {
    return this.chartReading.get(user.id, id);
  }
}
