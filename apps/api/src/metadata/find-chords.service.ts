import { Injectable, Logger } from "@nestjs/common";
import { chordSongs, type ChordSong, type MetadataMatch } from "@oneverse/core";
import { SongProviderService } from "../plugins/song-provider/song-provider.service.js";
import { MetadataService } from "./metadata.service.js";

/**
 * Find chords (issues #157, #369): the songs with chords at the Song
 * provider plugin's servers, the same song from several one row with all
 * its versions, best rated first - and that song at the music services
 * (Apple Music, Deezer, Spotify, MusicBrainz, as the admin set Auto detect
 * up), so a chart taken comes with their details to review.
 */
@Injectable()
export class FindChordsService {
  private readonly logger = new Logger(FindChordsService.name);

  constructor(
    private readonly songProviders: SongProviderService,
    private readonly metadata: MetadataService,
  ) {}

  /** The music services' matches; none when they're off or failing - Find chords works without them. */
  private async serviceMatches(title: string, artist: string | null | undefined): Promise<MetadataMatch[]> {
    try {
      return (await this.metadata.search(title, artist, ["song_providers"])).matches;
    } catch (error) {
      this.logger.debug(`No music service match for Find chords: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  async search(title: string, artist?: string | null, language?: string | null): Promise<{ songs: ChordSong[]; unavailable: string[] }> {
    // With an artist the services are asked at once; without, for the artist of the best song found, so they look for the right recording.
    const early = artist ? this.serviceMatches(title, artist) : null;
    const { answers, unavailable } = await this.songProviders.searchChords(title, artist, language);
    const top = artist ? null : answers.flatMap((answer) => answer.songs).find((song) => song.hasContent || song.versions.length);
    const matches = early ? await early : top ? await this.serviceMatches(top.title, top.artists[0]) : [];
    return { songs: chordSongs(answers, matches), unavailable };
  }
}
