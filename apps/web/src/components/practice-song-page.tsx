import { chartNotation, cueSectionsOf, getLanguageDisplayName, metronomeForSong, playsFiles, renderChart, type PlaybackSource, type Attachment, type CapoDisplayModeValue, type ChordDiagramsValue, type DiagramPlayer, type ChordNotationValue, type LiveViewValue, type SavedDisplaySettings, type SongVersionDetail } from "@oneverse/core";
import { CapoBadge } from "#/components/capo-badge";
import { Link, useNavigate, useRouteContext, useRouter } from "@tanstack/react-router";
import { PresenceChip } from "#/components/presence";
import { useSongPresence, watchSong } from "#/lib/live-notes";
import { TempoControl } from "#/components/tempo-control";
import { ChevronDown, ListPlus, Metronome, Mic, MoreHorizontal, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { startMetronome, stopMetronome, useMetronome } from "#/lib/metronome-engine";
import { setRecordingClick, useRecordingClick } from "#/lib/recording-click";
import { unlockSyncAudio } from "#/lib/sync-client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { cn } from "@oneverse/ui/lib/utils";
import { BarsRow } from "#/components/bars-row";
import { DisplayPanel } from "#/components/display-panel";
import { chartDisplayProps, useDiagramPlayer, useDisplaySettings } from "#/lib/display-settings";
import { ChartWithDiagrams } from "#/components/chord-diagrams";
import { ChartOrPdf, songViewStore } from "#/components/chart-or-pdf";
import { ChordGrid } from "#/components/chord-grid";
import { Button } from "@oneverse/ui/components/button";
import { AddToSetButton, AddToSetPopover } from "#/components/add-to-set";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { useSongPlayback } from "#/components/song-playback";
import { songPlaybackStore } from "#/lib/playback";
import { apiClient } from "#/lib/api-client";
import { fileLoader } from "#/lib/song-files";
import { artistNames } from "#/lib/artists";
import { setMode } from "#/lib/mode";
import { useChartNotes } from "#/components/notes";
import { useSongNotes } from "#/lib/notes";
import { useSungLine } from "#/lib/sung-line";
import { TracksView } from "#/components/tracks-view";
import { stemsOf, useStems } from "#/lib/stem-engine";

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
  const { t } = useTranslation();
  const router = useRouter();
  // How Practice reads (issue #209), as the Display panel changes it.
  const display = useDisplaySettings("PRACTICE", { account: { chordNotation: notation, capoDisplayMode: capoDisplay, chordDiagrams: diagrams, chordColors: colors }, saved: displaySettings });
  const player = useDiagramPlayer(accountPlayer);
  // Their own tempo for it, practising (issue #382): kept with their chart preferences, the song's own untouched.
  const [practiceTempo, setPracticeTempo] = useState<number | null>(null);
  useEffect(() => {
    setPracticeTempo(null);
    let current = true;
    apiClient
      .getChartPreferences(version.id)
      .then((preferences) => current && setPracticeTempo(preferences.tempo ?? null))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [version.id]);
  const changeTempo = (tempo: number | null) => {
    setPracticeTempo(tempo);
    void apiClient.saveChartPreferences(version.id, null, { tempo }).catch(() => {});
  };
  const written = useMemo(
    () =>
      renderChart(version.documentJson, null, {
        notation: chartNotation(display.chordNotation),
        capoDisplay: display.capoDisplayMode === "FINGERED" ? "shapes" : "sounding",
        suggestedCapo: version.capo,
      }),
    [version, display.chordNotation, display.capoDisplayMode],
  );
  // Played at their tempo: the metronome, the bars and the grid's click.
  const chart = useMemo(() => (practiceTempo ? { ...written, tempo: practiceTempo } : written), [written, practiceTempo]);
  // Notes on the chart (issue #256).
  const notesContext = { songVersionId: version.id, songbookId };
  const notes = useChartNotes({ state: useSongNotes(notesContext), chart, document: version.documentJson, show: display.notes, marks: display.noteMarks, style: display.noteStyle, context: notesContext, openNoteId });
  // Live (issue #27): who's editing it, and a save made meanwhile - loaded on a tap, the chart never moving by itself.
  const { session } = useRouteContext({ from: "/_protected" });
  const editors = useSongPresence(version.id, session.userId);
  const [changed, setChanged] = useState(false);
  const revision = version.documentJson.revision;
  useEffect(() => {
    setChanged(false);
    return watchSong({ songVersionId: version.id }, { onSaved: (saved) => setChanged(saved.revision > revision) });
  }, [version.id, revision]);
  const cueSections = useMemo(() => cueSectionsOf(version.documentJson), [version]);
  const youtubeId = version.identifiers.find((identifier) => identifier.type === "YOUTUBE")?.value ?? null;
  const returnTo = `/library/${version.id}`;
  // What plays with it (issue #366): one control, its choice docked at the bottom.
  const playbackStore = useMemo(() => songPlaybackStore(version.id), [version.id]);
  const playback = useSongPlayback({
    songVersionId: version.id,
    title: version.title,
    returnTo,
    attachments,
    load: fileLoader(version.id, false),
    youtube: youtubeId ? { id: youtubeId } : null,
    tempo: chart.tempo,
    tempoUnit: chart.tempoUnit,
    metronomeBeats: chart.metronomeBeats,
    timeSignature: chart.timeSignature,
    store: playbackStore,
    stems: { songKey: chart.key, cueSections, record: { attachments, songKey: chart.key ?? undefined, onSaved: () => void router.invalidate() } },
    // What plays is picked in the dock, and the metronome is the tempo pill's (issue #390).
    controlInDock: true,
    clickInPage: true,
  });
  const hasTracks = stemsOf(attachments).length > 0;
  // The More menu's Add to set opens its list by the menu.
  const more = useRef<HTMLButtonElement>(null);
  const [addingToSet, setAddingToSet] = useState(false);
  // The line sung as the stems or the click play (issue #365): read along, while recording a part too.
  const chartArea = useRef<HTMLDivElement>(null);
  useSungLine(chartArea, version.id, chart, version.documentJson);
  const details = [...references, chart.key].filter(Boolean);

  return (
    <div className="flex flex-col gap-4 sm:gap-6" data-testid="practice-song">
      {/* A calmer header (issue #390): the title and its actions, then the song's key, tempo and version as pills. */}
      <div className="flex flex-col gap-2.5">
        <div className="flex min-w-0 items-center gap-3">
          {/* Its album art (issues #146, #152): small, beside the title, as in Edit. */}
          {version.imageUrl ? <img src={`${version.imageUrl}&w=128`} alt="" className="size-11 shrink-0 rounded-md object-cover shadow-sm sm:size-16" data-testid="song-art" /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 className="min-w-0 truncate text-xl font-semibold sm:text-2xl">{version.title}</h1>
            <p className="truncate text-sm text-muted-foreground" data-testid="practice-artists">
              {artistNames(version.artists)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {changed ? (
              <Button variant="outline" onClick={() => void router.invalidate()} data-testid="song-changed">
                <RefreshCw />
                <span className="max-sm:sr-only">
                  {t("presence.songChanged")} · {t("presence.load")}
                </span>
              </Button>
            ) : null}
            <DisplayPanel mode="PRACTICE" settings={display} player={player} tracks={hasTracks} className="h-9 max-sm:w-9 max-sm:px-0" labelClassName="max-sm:hidden" />
            {notes.button}
            {/* Into one of one's sets (issue #330), and Edit: buttons where there's room, in the menu on a phone. */}
            <AddToSetButton songVersionId={version.id} songTitle={version.title} className="max-sm:hidden" />
            <Button variant="outline" className="max-sm:hidden" onClick={() => setMode("edit")}>
              <Pencil />
              {t("practice.edit")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button ref={more} type="button" variant="ghost" size="icon" aria-label={t("practice.more")} data-testid="practice-more" />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="sm:hidden" onClick={() => setAddingToSet(true)} data-testid="practice-menu-add-to-set">
                  <ListPlus />
                  {t("sets.addToSet.button")}
                </DropdownMenuItem>
                <DropdownMenuItem className="sm:hidden" onClick={() => setMode("edit")} data-testid="practice-menu-edit">
                  <Pencil />
                  {t("practice.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link to="/library/$songVersionId/live" params={{ songVersionId: version.id }} />} onClick={() => setMode("live")} data-testid="practice-menu-live">
                  <Mic />
                  {t("live.start")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <AddToSetPopover songVersionId={version.id} songTitle={version.title} open={addingToSet} onOpenChange={setAddingToSet} anchor={more} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="practice-pills">
          {details.length > 0 ? <span className={PILL}>{details.join(" · ")}</span> : null}
          {/* The metronome, the tempo and the time signature, one pill: the page's only metronome (issue #390). */}
          <span className={cn(PILL, "gap-0 overflow-hidden p-0")}>
            <PracticeMetronome songId={version.id} chart={chart} source={playback.source} />
            <TempoControl tempo={chart.tempo} songTempo={written.tempo} tempoUnit={chart.tempoUnit} timeSignature={chart.timeSignature} hint={t("tempo.practiceHint")} onChange={changeTempo} testId="practice-tempo" className={cn("h-8 pl-1.5 no-underline", chart.timeSignature ? "pr-1.5" : "pr-3")} />
            {chart.timeSignature ? (
              <span className="pr-3 text-muted-foreground tabular-nums" data-testid="practice-time-signature">
                · {chart.timeSignature.numerator}/{chart.timeSignature.denominator}
              </span>
            ) : null}
          </span>
          <VersionPill songVersionId={version.id} workId={version.workId} versionName={version.versionName} />
          {/* The capo, hard to miss (issue #219). */}
          {chart.capo ? <CapoBadge capo={chart.capo} shapes={chart.capoShapes} /> : null}
          <PresenceChip people={editors} doing="editing" />
        </div>
      </div>

      {/* The bars (issue #238): the chords in bars and beats, with the metronome, kept in view as the page scrolls - under the header (h-14), never behind it. */}
      {display.bars ? <BarsRow songId={version.id} chart={chart} document={version.documentJson} chordColors={display.chordColors} metronome={false} className="sticky top-14 z-20 -mx-4 rounded-none sm:mx-0 sm:rounded-lg sm:border" /> : null}

      {/* The chart, its chord grid (issue #238) or its PDF (issue #152). */}
      <ChartOrPdf
        songVersionId={version.id}
        attachments={attachments}
        defaultView={liveView}
        store={songViewStore(version.id)}
        // Its parts as lanes, as in a DAW (issue #374), when it has stems.
        tracks={hasTracks ? <TracksView songVersionId={version.id} chart={chart} document={version.documentJson} attachments={attachments} cueSections={cueSections.sections} /> : undefined}
        grid={
          <Card>
            <CardContent style={{ zoom: display.textSize }}>
              <ChordGrid
                songId={version.id}
                chart={chart}
                document={version.documentJson}
                chordColors={display.chordColors}
                emptyText={t("sets.noChart")}
                // Bars placed by whoever can edit the song (issue #238), saved as the editor saves its chart.
                onSave={
                  version.canEdit
                    ? async (sections) => {
                        await apiClient.updateSongVersion(version.id, { sections, revision: version.documentJson.revision });
                        await router.invalidate();
                      }
                    : undefined
                }
              />
            </CardContent>
          </Card>
        }
      >
        <Card>
          <CardContent className="flex flex-col gap-3">
            {/* Zoom, not font size: the chart's own sizes keep their proportions. */}
            {notes.top}
            <div ref={chartArea} style={{ zoom: display.textSize }} data-testid="practice-chart">
              <ChartWithDiagrams chart={chart} emptyText={t("sets.noChart")} {...chartDisplayProps(display)} player={player} songVersionId={version.id} notes={notes.layer} />
            </div>
          </CardContent>
        </Card>
      </ChartOrPdf>

      {notes.dialogs}

      {/* What plays with it, docked at the bottom (issues #64, #66, #366). */}
      {playback.dock}
    </div>
  );
}

const PILL = "inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-sm font-medium";

/**
 * The song's metronome, in its tempo pill (issue #390): one press, whatever
 * plays. While the stems or the recording play, it's their click; else the
 * song's own metronome, at its tempo, time signature and pattern - which
 * hands over to their click when they start.
 */
function PracticeMetronome({ songId, chart, source }: { songId: string; chart: Pick<RenderedChartLike, "tempo" | "tempoUnit" | "timeSignature" | "metronomeBeats">; source: PlaybackSource }) {
  const { t } = useTranslation();
  const metronome = useMetronome();
  const click = useRecordingClick();
  const stems = useStems();
  // The stems (or the recording) of this song playing: the click goes with them.
  const withFiles = playsFiles(source) && stems.songVersionId === songId && stems.playing;
  const mine = metronome.playing && metronome.songId === songId;
  useEffect(() => {
    if (withFiles && mine && !metronome.following) {
      stopMetronome();
      setRecordingClick(true);
    }
  }, [withFiles, mine]);
  const on = withFiles ? click : mine;
  const tempo = chart.tempo;
  const press = () => {
    if (withFiles) return setRecordingClick(!click);
    if (metronome.following) return unlockSyncAudio();
    if (mine) return stopMetronome();
    if (tempo) startMetronome(metronomeForSong(metronome.settings, { tempo, tempoUnit: chart.tempoUnit, timeSignature: chart.timeSignature, beats: chart.metronomeBeats }), songId);
  };
  const label = withFiles ? t("stems.clickWith") : on ? t("metronome.songStop") : tempo ? t("metronome.songStart", { tempo }) : t("metronome.noTempo");
  return (
    <button
      type="button"
      onClick={press}
      disabled={!tempo && !withFiles && !metronome.following}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={cn("flex h-8 w-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 [&_svg]:size-4", on && "bg-primary text-primary-foreground hover:text-primary-foreground")}
      data-testid="practice-metronome"
    >
      <Metronome />
    </button>
  );
}

type RenderedChartLike = ReturnType<typeof renderChart>;

/**
 * Which version of the song this is (issue #390): its name, and the others
 * one can see to switch to; nothing when it's the only one and has no name.
 */
function VersionPill({ songVersionId, workId, versionName }: { songVersionId: string; workId: string; versionName: string | null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [versions, setVersions] = useState<{ id: string; label: string }[] | null>(null);
  useEffect(() => {
    let current = true;
    apiClient
      .getWork(workId)
      .then((work) => {
        if (!current) return;
        // Told apart by their names, else their languages.
        setVersions(work.versions.map((one) => ({ id: one.id, label: one.versionName || getLanguageDisplayName(one.language, i18n.language) })));
      })
      .catch(() => current && setVersions(null));
    return () => {
      current = false;
    };
  }, [workId, i18n.language]);
  const others = versions && versions.length > 1 ? versions : null;
  if (!others) return versionName ? <span className={PILL} data-testid="practice-version">{versionName}</span> : null;
  return (
    <label className={cn(PILL, "relative pr-2 text-primary")} data-testid="practice-version">
      <span className="truncate">{others.find((one) => one.id === songVersionId)?.label ?? versionName ?? t("practice.version")}</span>
      <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        value={songVersionId}
        onChange={(event) => void navigate({ to: "/library/$songVersionId", params: { songVersionId: event.target.value } })}
        aria-label={t("practice.versions")}
        data-testid="practice-version-select"
      >
        {others.map((one) => (
          <option key={one.id} value={one.id}>
            {one.label}
          </option>
        ))}
      </select>
    </label>
  );
}
