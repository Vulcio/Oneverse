import { keptFile, keptSongCopy, type Attachment } from "@oneverse/core";
import { apiClient } from "#/lib/api-client";
import { deviceStorage } from "#/lib/offline-data";

/**
 * A song's files as this device sees them: the API's list, or - when it
 * can't be reached - the copy kept on the device (issue #50), and how to
 * load one of them either way. For the stem player on a set's song page
 * and Sync play's followers alike (issue #112 made them one).
 */
export async function songFiles(songVersionId: string): Promise<{ attachments: Attachment[]; offline: boolean }> {
  try {
    return { attachments: await apiClient.listAttachments(songVersionId), offline: false };
  } catch {
    return { attachments: (await keptSongCopy(deviceStorage(), songVersionId))?.attachments ?? [], offline: true };
  }
}

/** One of the song's files: downloaded, or from the device when the list came from there. */
export function fileLoader(songVersionId: string, offline: boolean) {
  return async (file: Attachment, onProgress?: (received: number, total: number | null) => void): Promise<Blob> => {
    if (!offline) return apiClient.downloadAttachment(songVersionId, file.id, onProgress);
    const blob = await keptFile<Blob>(deviceStorage(), file.id);
    if (!blob) throw new Error("not kept");
    return blob;
  };
}
