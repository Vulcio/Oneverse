import { Body, Controller, Get, NotFoundException, Param, Put, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { ChordShapeChoice } from "@oneverse/core";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ChooseChordShapeDto } from "./dto/chord-shapes.dto.js";

/**
 * The shapes a player chose for a song's chords (issue #207 phase 3): their
 * own, for that song only, per instrument and tuning. Only ever the caller's
 * own choices are read or written - nothing about the song is given away - so
 * a song shared into a set they play works as well as one in their library.
 */
@ApiTags("song-versions")
@ApiBearerAuth()
@Controller("song-versions/:songVersionId/chord-shapes")
export class ChordShapesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songVersionId") songVersionId: string): Promise<ChordShapeChoice[]> {
    if (!user) throw new UnauthorizedException();
    return this.prisma.client.chordShapeChoice.findMany({
      where: { userId: user.id, songVersionId },
      select: { instrument: true, tuning: true, chord: true, frets: true },
      orderBy: { chord: "asc" },
    }) as Promise<ChordShapeChoice[]>;
  }

  /** Keeps the shape chosen for a chord of this song; `frets` null forgets it (back to the usual one). */
  @Put()
  async choose(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("songVersionId") songVersionId: string,
    @Body() dto: ChooseChordShapeDto,
  ): Promise<ChordShapeChoice[]> {
    if (!user) throw new UnauthorizedException();
    await this.assertSong(songVersionId);
    const key = { userId: user.id, songVersionId, instrument: dto.instrument, tuning: dto.tuning, chord: dto.chord };
    if (dto.frets === null) {
      await this.prisma.client.chordShapeChoice.deleteMany({ where: key });
    } else {
      await this.prisma.client.chordShapeChoice.upsert({
        where: { userId_songVersionId_instrument_tuning_chord: key },
        create: { ...key, frets: dto.frets },
        update: { frets: dto.frets },
      });
    }
    return this.list(user, songVersionId);
  }

  private async assertSong(songVersionId: string) {
    const song = await this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { id: true } });
    if (!song) throw new NotFoundException("Song version not found");
  }
}
