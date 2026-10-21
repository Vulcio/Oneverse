import { isNetworkError, onlineOrKept } from "@oneverse/core";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { loadOfflineSong, OfflineSongPage, type OfflineSong } from "#/components/offline-song-page";
import { PracticeSongPage } from "#/components/practice-song-page";
import { SongEditor } from "#/components/song-editor/song-editor";
import { useMode } from "#/lib/mode";
import { apiClient } from "#/lib/api-client";
import { parseNotices, parseSongSearch } from "./-song-search";
import { useSongView } from "#/lib/song-views";
import { useRevealLine } from "#/lib/lyrics-search";
import { SongNeighborsBar } from "#/components/song-neighbors";

export const Route = createFileRoute("/_protected/library/$songVersionId")({
  validateSearch: parseSongSearch,
  // Offline, a kept song's read-only page instead (issue #52).
  loader: ({ params }) =>
    onlineOrKept<{ online: Awaited<ReturnType<typeof loadOnline>> } | { offline: OfflineSong }>(
      async () => ({ online: await loadOnline(params.songVersionId) }),
      async () => {
        const song = await loadOfflineSong(params.songVersionId);
        return song && { offline: song };
      },
    ),
  component: SongVersionPage,
});

async function loadOnline(songVersionId: string) {
  const version = await apiClient.getSongVersion(songVersionId).catch((error: unknown) => {
    if (isNetworkError(error)) throw error;
    return null;
  });
  if (!version) throw redirect({ to: "/library" });
  const [recordingMatch, workMatch, tags, songbookMemberships, attachments, me] = await Promise.all([
    apiClient.getSongMetadata(version.id).catch(() => null),
    apiClient.getWorkMusicBrainz(version.workId).catch(() => null),
    apiClient.listTags(),
    apiClient.getSongVersionSongbooks(version.id),
    apiClient.listAttachments(version.id),
    // The player's chord settings, for Practice's chart.
    apiClient.getMe().catch(() => null),
  ]);
  return { version, recordingMatch, workMatch, tags, songbookMemberships, attachments, me };
}

function SongVersionPage() {
  const loaded = Route.useLoaderData();
  const { tab, notice, from, songbook, line, note } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { mode } = useMode();
  const songVersionId = "offline" in loaded ? loaded.offline.songVersionId : loaded.online.version.id;
  useSongView(songVersionId);
  useRevealLine(line);

  // Live: the song full screen, as a set's song is (issue #67); its × comes back to the library.
  useEffect(() => {
    if (mode === "live") void navigate({ to: "/library/$songVersionId/live", params: { songVersionId }, search: { back: "/library", ...(line && { line }) }, replace: true });
  }, [mode, navigate, songVersionId, line]);
  if (mode === "live") return null;

  if ("offline" in loaded) return <OfflineSongPage song={loaded.offline} />;
  const data = loaded.online;
  // Practice: the chart, not the editor (issue #67).
  // Previous and next in the list it was opened from (issue #84).
  const neighbors = <SongNeighborsBar songVersionId={data.version.id} from={from} songbook={songbook} />;
  if (mode === "practice") {
    return (
      <>
        {neighbors}
        <PracticeSongPage
        version={data.version}
        attachments={data.attachments}
        references={data.songbookMemberships.filter((membership) => membership.entryCode).map((membership) => membership.reference)}
        notation={data.me?.chordNotation ?? "LETTERS"}
        capoDisplay={data.me?.capoDisplayMode ?? "SOUNDING"}
        liveView={data.me?.liveView ?? "CHART"}
        diagrams={data.me?.chordDiagrams ?? "OFF"}
        colors={data.me?.chordColors ?? false}
        player={data.me ?? undefined}
        displaySettings={data.me?.displaySettings}
        songbookId={songbook}
        openNoteId={note}
        />
      </>
    );
  }
  return (
    <>
      {neighbors}
      <SongEditor
      key={data.version.id}
      mode="edit"
      {...data}
      notices={parseNotices(notice)}
      songbookId={songbook}
      openNoteId={note}
      // Opened at a line (a lyrics search, issue #221): where the chart is.
      tab={tab ?? (line ? "editor" : "info")}
      onTabChange={(next) => void navigate({ search: (prev) => ({ ...prev, tab: next === "info" ? undefined : next }), replace: true })}
      />
    </>
  );
}
