import type { PrismaClient } from "@oneverse/db";
import type { StorageService } from "../storage/storage.service.js";
import { capabilitiesOf, ownCapabilities } from "./capabilities.js";

/**
 * Whether someone may upload audio files to a song (issue #183), and keep
 * lossless originals (#182): a role of the server's, or - when the song's
 * files go to its organisation's own bucket (issue #206) - one of that
 * organisation's own roles, since it's the organisation's space they use.
 */
export async function audioRights(prisma: PrismaClient, storage: Pick<StorageService, "locationForSong">, userId: string, songVersionId: string | null): Promise<{ canUploadAudio: boolean; canKeepLosslessAudio: boolean }> {
  const server = await capabilitiesOf(prisma, userId);
  if (server.canUploadAudio && server.canKeepLosslessAudio) return { canUploadAudio: true, canKeepLosslessAudio: true };
  const location = songVersionId ? await storage.locationForSong(songVersionId) : null;
  if (!location) return { canUploadAudio: server.canUploadAudio, canKeepLosslessAudio: server.canKeepLosslessAudio };
  const own = await ownCapabilities(prisma, userId, { organizationId: location });
  return { canUploadAudio: server.canUploadAudio || own.canUploadAudio, canKeepLosslessAudio: server.canKeepLosslessAudio || own.canKeepLosslessAudio };
}
