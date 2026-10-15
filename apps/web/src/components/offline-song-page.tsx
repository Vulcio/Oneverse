import { chartNotation, cueSectionsOf, findKeptSong, inlineSafeType, keptFile, keptSongCopy, offlineViewer, renderChart, type Attachment, type CapoDisplayModeValue, type ChordDiagramsValue, type DiagramPlayer, type ChordNotationValue, type FoundSong, type SavedDisplaySettings } from "@songverse/core";
import { Link } from "@tanstack/react-router";
import { FileText, Mic } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DisplayPanel } from "#/components/display-panel";
import { chartDisplayProps, displayModeOf, useDiagramPlayer, useDisplaySettings } from "#/lib/display-settings";
import { ChartWithDiagrams } from "#/components/chord-diagrams";
import { useChartNotes } from "#/components/notes";
import { useSongNotes } from "#/lib/notes";
import { StemDock } from "#/components/stem-dock";
import { downloadBlob } from "#/lib/download";
import { stemFilesOf, useChosenMultitrack } from "#/lib/stem-engine";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { formatBytes } from "#/lib/format-bytes";
import { setMode, useMode } from "#/lib/mode";
import { keysOffline } from "#/lib/offline-db";
import { deviceStorage } from "#/lib/offline-data";

/** A song as kept on the device, with its files' list and the player's chord settings. */
export interface OfflineSong extends FoundSong {
  attachments: Attachment[];
  notation: ChordNotationValue;
  capoDisplay: CapoDisplayModeValue;
  /** Chord diagrams beside the chart (issue #207), as of the last sync. */
  diagrams: ChordDiagramsValue;
  colors: boolean;
  player: DiagramPlayer;
  /** Each mode's display settings (issue #209), as of the last sync. */
  displaySettings: SavedDisplaySettings | null;
}

/** The song as kept on the device (on its own, or in a kept set), if it is. */
export async function loadOfflineSong(songVersionId: string): Promise<OfflineSong | undefined> {
  const storage = deviceStorage();
  const [found, kept, viewer] = await Promise.all([findKeptSong(storage, songVersionId), keptSongCopy(storage, songVersionId), offlineViewer(storage)]);
  if (!found) return undefined;
  return {
    ...found,
    attachments: kept?.attachments ?? [],
    notation: viewer?.chordNotation ?? "LETTERS",
    capoDisplay: viewer?.capoDisplayMode ?? "SOUNDING",
    diagrams: viewer?.chordDiagrams ?? "OFF",
    colors: viewer?.chordColors ?? false,
    player: viewer ?? {},
    displaySettings: viewer?.displaySettings ?? null,
  };
}

/**
 * A song's page offline (issue #52): read-only - its chart as written, with
 * the player's chord settings, the files kept on the device, and Live.
 */
export function OfflineSongPage({ song }: { song: OfflineSong }) {
  const { t } = useTranslation();
  const { mode } = useMode();
  // How this mode reads (issue #209), as the Display panel changes it.
  const displayMode = displayModeOf(mode);
  const display = useDisplaySettings(displayMode, {
    account: { chordNotation: song.notation, capoDisplayMode: song.capoDisplay, chordDiagrams: song.diagrams, chordColors: song.colors },
    saved: song.displaySettings,
  });
  const player = useDiagramPlayer(song.player);
  const [keptFiles, setKeptFiles] = useState<Set<string>>(new Set());
  const chart = useMemo(
    () =>
      renderChart(song.document, null, {
        notation: chartNotation(display.chordNotation),
        capoDisplay: display.capoDisplayMode === "FINGERED" ? "shapes" : "sounding",
        suggestedCapo: song.capo,
      }),
    [song, display.chordNotation, display.capoDisplayMode],
  );

  // The notes kept with it (issue #256); new ones wait for the network.
  const notesContext = { songVersionId: song.songVersionId };
  const notes = useChartNotes({ state: useSongNotes(notesContext), chart, document: song.document, show: display.notes, marks: display.noteMarks, style: display.noteStyle, context: notesContext });

  useEffect(() => {
    void keysOffline("files").then((keys) => setKeptFiles(new Set(keys)));
  }, [song.songVersionId]);

  const playable = stemFilesOf(song.attachments.filter((file) => keptFiles.has(file.id)), useChosenMultitrack(song.songVersionId));

  async function open(file: Attachment) {
    const blob = await keptFile<Blob>(deviceStorage(), file.id);
    if (!blob) return;
    // A blob: URL is this page's own origin: only a type that can't carry a
    // script is shown there, anything else is saved instead (issue #112).
    const type = inlineSafeType(file.mimeType);
    if (!type) return downloadBlob(blob, file.filename);
    window.open(URL.createObjectURL(new Blob([blob], { type })), "_blank");
  }

  return (
    <div className="flex flex-col gap-6" data-testid="offline-song">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold">
            {song.title}
            {song.versionName ? <span className="font-normal text-muted-foreground"> — {song.versionName}</span> : null}
          </h1>
          {song.artists ? <p className="text-sm text-muted-foreground">{song.artists}</p> : null}
          <p className="text-sm text-muted-foreground">{t("offline.songReadOnly")}</p>
        </div>
        <div className="flex items-center gap-2">
        <DisplayPanel mode={displayMode} settings={display} player={player} className="h-9" />
        {notes.button}
        <Button onClick={() => setMode("live")} render={<Link to="/library/$songVersionId/live" params={{ songVersionId: song.songVersionId }} />}>
            <Mic />
            {t("live.start")}
          </Button>
        </div>
      </div>

      {/* Practice: the stems kept on the device (with "Include audio"), docked at the bottom. */}
      {mode === "practice" && playable.stems.length > 0 ? (
        <StemDock
          song={{
            songVersionId: song.songVersionId,
            title: song.title,
            returnTo: `/library/${song.songVersionId}`,
            ...playable,
            load: async (file) => {
              const blob = await keptFile<Blob>(deviceStorage(), file.id);
              if (!blob) throw new Error("not kept");
              return blob;
            },
            cueSections: cueSectionsOf(song.document),
          }}
        />
      ) : null}

      <Card>
        <CardContent>
          {notes.top}
          <div style={{ zoom: display.textSize }}>
            <ChartWithDiagrams chart={chart} {...chartDisplayProps(display)} player={player} songVersionId={song.songVersionId} notes={notes.layer} />
          </div>
          {notes.dialogs}
        </CardContent>
      </Card>

      {song.attachments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("offline.files")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {song.attachments.map((file) => (
              <div key={file.id} className="flex items-center gap-3 text-sm" data-testid="offline-file">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                {file.sizeBytes ? <span className="text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</span> : null}
                {keptFiles.has(file.id) ? (
                  <Button variant="outline" size="sm" onClick={() => void open(file)}>
                    {t("offline.openFile")}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("offline.fileNotKept")}</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
