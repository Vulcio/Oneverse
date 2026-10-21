import { chartNotation, renderChart, type ChartPreferences, type RenderedChart, type ChordNotationValue, type CapoDisplayModeValue, type SetlistSongView } from "@songverse/core";
import { EyeOff, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DisplayPanel } from "#/components/display-panel";
import { chartDisplayProps, displayModeOf, displaySeed, useDiagramPlayer, useDisplaySettings } from "#/lib/display-settings";
import { useMode } from "#/lib/mode";
import { ChartWithDiagrams } from "#/components/chord-diagrams";
import { ChordGrid } from "#/components/chord-grid";
import { apiClient } from "#/lib/api-client";
import { useChartNotes } from "#/components/notes";
import { useSongNotes } from "#/lib/notes";
import { cn } from "@songverse/ui/lib/utils";

const EMPTY: ChartPreferences = { $schema: "chart-preferences/v1", hiddenChordIds: [], simplifyChords: false, hideBassNotes: false };

/** The chart of a set's song as the set plays it, through this player's view (their saved one by default). */
export function renderPlayerChart(
  view: SetlistSongView,
  preferences: ChartPreferences = view.view.preferences ?? EMPTY,
  notation: ChordNotationValue = view.view.chordNotation,
  capoDisplay: CapoDisplayModeValue = view.view.capoDisplayMode,
  /** Live's last-minute transpose, on top of the set's (issue #68). */
  extraSteps = 0,
): RenderedChart {
  const song = view.song!;
  return renderChart(song.document, view.arrangement?.document ?? null, {
    transposeSteps: view.item.transposeSteps + extraSteps,
    preferences,
    notation: chartNotation(notation),
    capoDisplay: capoDisplay === "FINGERED" ? "shapes" : "sounding",
    suggestedCapo: song.suggestedCapo,
  });
}

/**
 * A song of a set as this player reads it (docs/arrangement-document-v2.md,
 * "Personal chart preferences"): the arrangement the set plays, the set's
 * key on top, and the player's own view - chords they've hidden, simpler
 * chords, no bass notes, capo shapes, solfège. Changes save as they're
 * made, for this player only. `grid`: as its chord grid (issue #238).
 */
export function PlayerChart({ view, openNoteId, grid = false }: { view: SetlistSongView; /** A note's thread to open (a notification's link). */ openNoteId?: string; grid?: boolean }) {
  const { t } = useTranslation();
  const song = view.song!;
  const [preferences, setPreferences] = useState<ChartPreferences>(view.view.preferences ?? EMPTY);
  // How the chart reads in this mode (issue #209), as the Display panel changes it.
  const displayMode = displayModeOf(useMode().mode);
  const display = useDisplaySettings(displayMode, displaySeed(view.view));
  const player = useDiagramPlayer(view.view);
  const notation = display.chordNotation;
  const capoDisplay = display.capoDisplayMode;
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Another song of the set reuses this component.
  useEffect(() => {
    setPreferences(view.view.preferences ?? EMPTY);
    setHiding(false);
    setError(null);
  }, [view.item.id, view.item.arrangementId]);

  const chart = useMemo(() => renderPlayerChart(view, preferences, notation, capoDisplay), [view, preferences, notation, capoDisplay]);

  function savePreferences(next: ChartPreferences) {
    setPreferences(next);
    setError(null);
    // Its own fields only: the view (issue #155) is the view switch's, saved beside them.
    const mine = { hiddenChordIds: next.hiddenChordIds, simplifyChords: next.simplifyChords, hideBassNotes: next.hideBassNotes };
    apiClient.setSetlistChartPreferences(view.set.id, view.item.id, mine).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }

  // Notes seen in this set (issue #256): new ones saved in it by default.
  const notesContext = { songVersionId: song.id, setlistId: view.set.id };
  const notes = useChartNotes({ state: useSongNotes(notesContext), chart, document: song.document, show: display.notes, marks: display.noteMarks, style: display.noteStyle, context: notesContext, openNoteId });

  const hiddenCount = preferences.hiddenChordIds.length;
  const capoIsSuggestion = !view.arrangement?.document.defaults.capo && !!song.suggestedCapo;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("player.myView")}>
        <DisplayPanel mode={displayMode} settings={display} player={player} className="mr-1" />
        <span className="mr-1 [&>button]:h-7 [&>button]:text-xs">{notes.button}</span>
        <span className="mr-1 text-xs font-medium text-muted-foreground">{t("player.myView")}</span>
        {grid ? null : (
          <Toggle pressed={hiding} onClick={() => setHiding(!hiding)}>
            <EyeOff className="size-3.5" aria-hidden />
            {t("player.hideChords")}
          </Toggle>
        )}
        <Toggle pressed={preferences.simplifyChords} onClick={() => savePreferences({ ...preferences, simplifyChords: !preferences.simplifyChords })}>
          {t("player.simplify")}
        </Toggle>
        <Toggle pressed={preferences.hideBassNotes} onClick={() => savePreferences({ ...preferences, hideBassNotes: !preferences.hideBassNotes })}>
          {t("player.noBass")}
        </Toggle>
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => savePreferences({ ...preferences, hiddenChordIds: [] })}
          >
            {t("player.showHidden", { count: hiddenCount })}
          </button>
        ) : null}
      </div>
      {chart.capo ? (
        // Hard to miss (issue #219): a red pill with a warning sign; the chords in italics when they're shapes.
        <p className="inline-flex w-fit items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground" data-testid="capo">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {capoIsSuggestion ? t("player.suggestedCapo", { capo: chart.capo }) : t("player.capo", { capo: chart.capo })}
          {" · "}
          {capoDisplay === "FINGERED" ? t("player.showingShapes") : t("player.showingSounding")}
        </p>
      ) : null}
      {hiding && !grid ? <p className="text-xs text-muted-foreground">{t("player.hideHint")}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {notes.top}
      <div style={{ zoom: display.textSize }}>
        {grid ? (
          <ChordGrid songId={song.id} chart={chart} document={song.document} chordColors={display.chordColors} emptyText={t("sets.noChart")} />
        ) : (
          <ChartWithDiagrams
            notes={notes.layer}
            chart={chart}
            {...chartDisplayProps(display)}
            player={player}
            songVersionId={song.id}
            emptyText={t("sets.noChart")}
            onChordClick={hiding ? (id) => savePreferences({ ...preferences, hiddenChordIds: [...new Set([...preferences.hiddenChordIds, id])] }) : undefined}
          />
        )}
      </div>
      {notes.dialogs}
    </div>
  );
}

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
        pressed ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
