import { MusicBrainzRecordingMatchSchema, type MetadataMatch, type MusicBrainzRecordingMatch } from "@oneverse/core";
import type { MusicBrainzService } from "../musicbrainz/musicbrainz.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";

const BATCH = 100;

/** A MusicBrainz recording as the song info a song keeps (issue #22's summary). */
export function recordingAsMatch(match: MusicBrainzRecordingMatch): MetadataMatch {
  return {
    title: match.title,
    artist: match.artist,
    album: match.releaseTitle,
    releaseDate: match.releaseDate,
    artworkUrl: null,
    thumbnailUrl: null,
    sources: [{ provider: "musicbrainz", id: match.mbid, url: match.sourceUrl }],
  };
}

/** The songs linked to a MusicBrainz recording the old way (issue #116): a recording, no song info kept. */
export const legacyLinkedWhere = {
  type: "MUSICBRAINZ_RECORDING" as const,
  songVersion: { identifiers: { none: { type: "METADATA_MATCH" as const } } },
};

/**
 * Saves the song info of songs linked to a MusicBrainz recording before it
 * was kept with the link (issue #116), once, on the Worker's backfills
 * queue: from what the recording's identifier saved, else looked up at
 * MusicBrainz (its client takes its turn, `sharedTurn()`). Showing such a
 * song then never waits on MusicBrainz. A recording MusicBrainz can't find
 * is counted and left; the next run tries it again.
 */
export async function backfillMetadataMatches(prisma: PrismaService, musicBrainz: MusicBrainzService): Promise<{ saved: number; lookedUp: number; failed: number }> {
  let saved = 0;
  let lookedUp = 0;
  let failed = 0;
  let after: string | undefined;
  for (;;) {
    const rows = await prisma.client.songVersionIdentifier.findMany({
      where: { ...legacyLinkedWhere, ...(after && { id: { gt: after } }) },
      select: { id: true, songVersionId: true, value: true, sourceUrl: true, details: true },
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (rows.length === 0) return { saved, lookedUp, failed };
    after = rows.at(-1)!.id;
    for (const row of rows) {
      const kept = MusicBrainzRecordingMatchSchema.safeParse(row.details);
      let recording: MusicBrainzRecordingMatch;
      if (kept.success && kept.data.mbid === row.value) recording = kept.data;
      else {
        try {
          recording = await musicBrainz.getRecording(row.value);
          lookedUp++;
        } catch {
          failed++;
          continue;
        }
      }
      const match = recordingAsMatch(recording);
      const data = { value: `musicbrainz:${recording.mbid}`, sourceUrl: recording.sourceUrl, verifiedAt: new Date(), details: match as object };
      await prisma.client.songVersionIdentifier.upsert({
        where: { songVersionId_type: { songVersionId: row.songVersionId, type: "METADATA_MATCH" } },
        create: { songVersionId: row.songVersionId, type: "METADATA_MATCH", ...data },
        // Linked anew meanwhile: that link stays.
        update: {},
      });
      saved++;
    }
  }
}
