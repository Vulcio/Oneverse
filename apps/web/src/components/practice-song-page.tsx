import { chartNotation, cueSectionsOf, getLanguageDisplayName, renderChart, type Attachment, type CapoDisplayModeValue, type ChordDiagramsValue, type DiagramPlayer, type ChordNotationValue, type LiveViewValue, type SavedDisplaySettings, type SongVersionDetail } from "@songverse/core";
import { CapoBadge } from "#/components/capo-badge";
import { Link, useRouteContext, useRouter } from "@tanstack/react-router";
import { PresenceChip } from "#/components/presence";
import { useSongPresence, watchSong } from "#/lib/live-notes";
import { Mic, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MetronomeSongButton } from "#/components/metronome";
import { DisplayPanel } from "#/components/display-panel";
import { chartDisplayProps, useDiagramPlayer, useDisplaySettings } from "#/lib/display-settings";
import { ChartWithDiagrams } from "#/components/chord-diagrams";
import { ChartOrPdf, songViewStore } from "#/components/chart-or-pdf";
import { StemDock } from "#/components/stem-dock";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent } from "@songverse/ui/components/card";
import { YouTubeDock } from "#/components/youtube-dock";
import { apiClient } from "#/lib/api-client";
import { artistNames } from "#/lib/artists";
import { setMode } from "#/lib/mode";
import { stemFilesOf, useChosenMultitrack } from "#/lib/stem-engine";
import { useChartNotes } from "#/components/notes";
import { useSongNotes } from "#/lib/notes";

/**
 * A library song in Practice (issue #67): its chart, as written and read
 * through the player's chord settings, instead of the editor's tabs - with
 * Edit to go back to editing, and its stems, recording or YouTube video
 * docked at the bottom. A Practice toolbar comes later.
 */
export function PracticeSongPage({
  version,
  attachments,
  references,
  notation,
  capoDisplay,
  liveView,
  diagrams,
  colors,
  player: accountPlayer,
  displaySettings,
  songbookId,
  openNoteId,
}: {
  version: SongVersionDetail;
  attachments: Attachment[];
  references: string[];
  notation: ChordNotationValue;
  capoDisplay: CapoDisplayModeValue;
  /** How the player reads songs unless chosen for this one (issue #155). */
  liveView: LiveViewValue;
  /** Chord diagrams beside the chart (issue #207). */
  diagrams: ChordDiagramsValue;
  /** Chords coloured by family (issue #9). */
  colors: boolean;
  /** Left-handed diagrams and tunings (issue #207). */
  player?: DiagramPlayer;
  /** Each mode's display settings (issue #209). */
  displaySettings?: SavedDisplaySettings | null;
  /** Opened from this songbook: new notes are saved in it by default (issue #256). */
  songbookId?: string;
  /** A note's thread to open (a notification's link). */
  openNoteId?: string;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  // How Practice reads (issue #209), as the Display panel changes it.
  const display = useDisplaySettings("PRACTICE", { account: { chordNotation: notation, capoDisplayMode: capoDisplay, chordDiagrams: diagrams, chordColors: colors }, saved: displaySettings });
  const player = useDiagramPlayer(accountPlayer);
  const chart = useMemo(
    () =>
      renderChart(version.documentJson, null, {
        notation: chartNotation(display.chordNotation),
        capoDisplay: display.capoDisplayMode === "FINGERED" ? "shapes" : "sounding",
        suggestedCapo: version.capo,
      }),
    [version, display.chordNotation, display.capoDisplayMode],
  );
  // Notes on the chart (issue #256).
  const notesContext = { songVersionId: version.id, songbookId };
  const notes = useChartNotes({ state: useSongNotes(notesContext), chart, document: version.documentJson, show: display.notes, context: notesContext, openNoteId });
  // Live (issue #27): who's editing it, and a save made meanwhile - loaded on a tap, the chart never moving by itself.
  const { session } = useRouteContext({ from: "/_protected" });
  const editors = useSongPresence(version.id, session.userId);
  const [changed, setChanged] = useState(false);
  const revision = version.documentJson.revision;
  useEffect(() => {
    setChanged(false);
    return watchSong({ songVersionId: version.id }, { onSaved: (saved) => setChanged(saved.revision > revision) });
  }, [version.id, revision]);
  const playable = stemFilesOf(attachments, useChosenMultitrack(version.id));
  const cueSections = useMemo(() => cueSectionsOf(version.documentJson), [version]);
  const youtubeId = version.identifiers.find((identifier) => identifier.type === "YOUTUBE")?.value ?? null;
  const returnTo = `/library/${version.id}`;
  const details = [
    ...references,
    chart.key,
    chart.tempo ? `${chart.tempo} BPM` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6" data-testid="practice-song">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
        {/* Its album art (issues #146, #152): small, beside the title, as in Edit. */}
        {version.imageUrl ? <img src={`${version.imageUrl}&w=128`} alt="" className="size-14 shrink-0 rounded-md object-cover shadow-sm sm:size-16" data-testid="song-art" /> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            <span className="min-w-0 break-words">{version.title}</span>
            {version.versionName ? (
              <span className="rounded-full border px-2.5 py-0.5 text-sm font-medium text-muted-foreground">{version.versionName}</span>
            ) : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[artistNames(version.artists), getLanguageDisplayName(version.language, i18n.language)].filter(Boolean).join(" · ")}
          </p>
          {details.length > 0 ? <p className="text-sm font-medium text-muted-foreground">{details.join(" · ")}</p> : null}
          <PresenceChip people={editors} doing="editing" />
          {/* The capo, hard to miss (issue #219). */}
          {chart.capo ? <CapoBadge capo={chart.capo} shapes={chart.capoShapes} /> : null}
        </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {changed ? (
            <Button variant="outline" onClick={() => void router.invalidate()} data-testid="song-changed">
              <RefreshCw />
              {t("presence.songChanged")} · {t("presence.load")}
            </Button>
          ) : null}
          <DisplayPanel mode="PRACTICE" settings={display} player={player} className="h-9" />
          {notes.button}
          <MetronomeSongButton songId={version.id} tempo={chart.tempo} timeSignature={chart.timeSignature} variant="button" />
          <Button variant="outline" onClick={() => setMode("edit")}>
            <Pencil />
            {t("practice.edit")}
          </Button>
          <Button onClick={() => setMode("live")} render={<Link to="/library/$songVersionId/live" params={{ songVersionId: version.id }} />}>
              <Mic />
              {t("live.start")}
            </Button>
        </div>
      </div>

      {/* The chart, or its PDF (issue #152). */}
      <ChartOrPdf songVersionId={version.id} attachments={attachments} defaultView={liveView} store={songViewStore(version.id)}>
        <Card>
          <CardContent className="flex flex-col gap-3">
            {/* Zoom, not font size: the chart's own sizes keep their proportions. */}
            {notes.top}
            <div style={{ zoom: display.textSize }}>
              <ChartWithDiagrams chart={chart} emptyText={t("sets.noChart")} {...chartDisplayProps(display)} player={player} songVersionId={version.id} notes={notes.layer} />
            </div>
          </CardContent>
        </Card>
      </ChartOrPdf>

      {notes.dialogs}

      {/* Its stems or recording, else its YouTube video, docked at the bottom (issues #64, #66). */}
      {playable.stems.length > 0 ? (
        <StemDock
          song={{
            songVersionId: version.id,
            title: version.title,
            returnTo,
            ...playable,
            load: (file, onProgress) => apiClient.downloadAttachment(version.id, file.id, onProgress),
            tempo: chart.tempo,
            timeSignature: chart.timeSignature,
            songKey: chart.key,
            cueSections,
            record: { attachments, songKey: chart.key ?? undefined, onSaved: () => void router.invalidate() },
          }}
        />
      ) : youtubeId ? (
        <YouTubeDock video={{ songVersionId: version.id, videoId: youtubeId, title: version.title, returnTo }} />
      ) : null}
    </div>
  );
}
