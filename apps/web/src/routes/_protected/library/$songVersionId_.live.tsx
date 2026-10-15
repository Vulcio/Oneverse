import { chartNotation, findKeptSong, isNetworkError, keptSongReferences, offlineViewer, onlineOrKept, renderChart, type CapoDisplayModeValue, type ChordDiagramsValue, type DiagramPlayer, type ChordNotationValue, type LiveViewValue, type SavedDisplaySettings, type SongDocumentV2 } from "@songverse/core";
import { useRevealLine } from "#/lib/lyrics-search";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { songViewStore, useReadingView } from "#/components/chart-or-pdf";
import { LiveView } from "#/components/live-view";
import { apiClient } from "#/lib/api-client";
import { artistNames } from "#/lib/artists";
import { setMode } from "#/lib/mode";
import { deviceStorage } from "#/lib/offline-data";
import { useSongView } from "#/lib/song-views";
import { useDiagramPlayer, useDisplaySettings } from "#/lib/display-settings";

/** What playing a song on its own needs: from the library online, from a kept set offline. */
export interface LoneSong {
  id: string;
  title: string;
  artists: string | null;
  /** "JEM 855 · JEM3" (issue #59). */
  references: string[];
  document: SongDocumentV2;
  capo: number | null;
  notation: ChordNotationValue;
  capoDisplay: CapoDisplayModeValue;
  /** How the player reads songs unless chosen for this one (issue #155). */
  liveView: LiveViewValue;
  /** Chord diagrams beside the chart (issue #207). */
  diagrams: ChordDiagramsValue;
  colors: boolean;
  player: DiagramPlayer;
  /** Each mode's display settings (issue #209). */
  displaySettings: SavedDisplaySettings | null;
}

/**
 * A song on its own, full screen, in Live mode (issue #48): one the leader
 * calls that isn't in the set, pulled up with the search. `back` is where
 * it was pulled up from, which the × returns to (else the library; a
 * library song opened in Live comes here too, issue #67). Offline, any song kept on
 * the device, on its own or in a kept set (issues #50, #52).
 */
export const Route = createFileRoute("/_protected/library/$songVersionId_/live")({
  staticData: { fullScreen: true },
  // Only a path in the app: never another site.
  validateSearch: (search: Record<string, unknown>): { back?: string; line?: string } => ({
    ...(typeof search.back === "string" && search.back.startsWith("/") && !search.back.startsWith("//") && { back: search.back }),
    // Found by its words (issue #221): the line it opens at.
    ...(typeof search.line === "string" && search.line && { line: search.line }),
  }),
  loader: ({ params }) =>
    onlineOrKept<LoneSong>(
      async () => {
        const [version, me, memberships] = await Promise.all([
          apiClient.getSongVersion(params.songVersionId).catch((error: unknown) => {
            if (isNetworkError(error)) throw error;
            return null;
          }),
          apiClient.getMe(),
          apiClient.getSongVersionSongbooks(params.songVersionId).catch(() => []),
        ]);
        if (!version) throw redirect({ to: "/library" });
        return {
          id: version.id,
          title: version.title,
          artists: artistNames(version.artists),
          references: memberships.filter((membership) => membership.entryCode).map((membership) => membership.reference),
          document: version.documentJson,
          capo: version.capo,
          notation: me.chordNotation,
          capoDisplay: me.capoDisplayMode,
          liveView: me.liveView,
          diagrams: me.chordDiagrams,
          colors: me.chordColors,
          player: me,
          displaySettings: me.displaySettings ?? null,
        };
      },
      async () => {
        const storage = deviceStorage();
        const [song, viewer, references] = await Promise.all([
          findKeptSong(storage, params.songVersionId),
          offlineViewer(storage),
          keptSongReferences(storage, params.songVersionId),
        ]);
        if (!song) return undefined;
        return {
          id: song.songVersionId,
          title: song.title,
          artists: song.artists,
          references,
          document: song.document,
          capo: song.capo,
          notation: viewer?.chordNotation ?? "LETTERS",
          capoDisplay: viewer?.capoDisplayMode ?? "SOUNDING",
          liveView: viewer?.liveView ?? "CHART",
          diagrams: viewer?.chordDiagrams ?? "OFF",
          colors: viewer?.chordColors ?? false,
          player: viewer ?? {},
          displaySettings: viewer?.displaySettings ?? null,
        };
      },
    ),
  component: SongLiveRoute,
});

function SongLiveRoute() {
  const song = Route.useLoaderData();
  const { back, line } = Route.useSearch();
  useRevealLine(line);
  useEffect(() => setMode("live"), []);
  useSongView(song.id);
  return <SongLiveView song={song} back={back} />;
}

function SongLiveView({ song, back }: { song: LoneSong; back: string | undefined }) {
  const { t } = useTranslation();
  const router = useRouter();
  // Its chart or its PDF, as this player reads it (issue #155).
  const reading = useReadingView(song.id, undefined, song.liveView, songViewStore(song.id));
  // How Live reads (issue #209), as the Display panel changes it.
  const display = useDisplaySettings("LIVE", {
    account: { chordNotation: song.notation, capoDisplayMode: song.capoDisplay, chordDiagrams: song.diagrams, chordColors: song.colors },
    saved: song.displaySettings,
  });
  const player = useDiagramPlayer(song.player);
  return (
    <LiveView
      songs={[{
        id: song.id,
        title: song.title,
        artist: song.artists,
        setName: null,
        setId: null,
        // As written, through the player's own chord settings; moved only by the last-minute transpose.
        chartFor: (extraSteps) =>
          renderChart(song.document, null, {
            transposeSteps: extraSteps,
            notation: chartNotation(display.chordNotation),
            capoDisplay: display.capoDisplayMode === "FINGERED" ? "shapes" : "sounding",
            suggestedCapo: song.capo,
          }),
        keyShift: 0,
        durationSeconds: song.document.defaults.durationSeconds,
        arrangementName: null,
        references: song.references,
        setNotes: [],
        // Its notes outside any set (issue #256).
        notes: { context: { songVersionId: song.id }, document: song.document },
        exit: {
          label: t("live.back"),
          // The song's own page would open Live again: the library instead.
          go: () => (back ? router.history.push(back) : void router.navigate({ to: "/library" })),
        },
        previous: null,
        next: null,
        nextLabel: null,
        reading,
        player,
        songVersionId: song.id,
      }]}
      display={display}
    />
  );
}
