import { NOTE_COLORS, NOTE_PRESETS, notePresetOf, type NoteColor, type NoteLook, type NotePlacement, type NotePreset, type NoteSize, type NoteStyle, type DiagramPositionValue, SECOND_ROW_GAPS, SECOND_ROW_SIZES, type ChordRow, type SecondChordRow, CONTROLS_POSITIONS, DISPLAY_TEXT_SIZES, LIVE_CONTROLS, type ControlsPositionValue, type AppModeValue, type ChordDiagramsValue, type DiagramPlayer, type DisplayColumnsValue, type EffectiveDisplaySettings } from "@oneverse/core";
import {
  ArrowDown,
  Superscript,
  Layers2,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowRight,
  CircleDot,
  Columns2,
  Columns3,
  Ear,
  Eye,
  EyeOff,
  FoldVertical,
  Guitar,
  Hand,
  LayoutGrid,
  Link2,
  Minus,
  Music,
  Palette,
  PanelBottom,
  PanelRight,
  PanelTop,
  Plus,
  RectangleVertical,
  RotateCcw,
  Rows3,
  SlidersHorizontal,
  Type,
  UnfoldVertical,
  Unlink2,
  X,
  type LucideIcon,
  MessageSquare,
  MessageSquareOff,
  ChevronDown,
  Highlighter,
  Zap,
  UserRound,
  AudioLines,
  Grid2x2,
  Repeat,
  Pencil,
  Square,
  MicVocal,
  ListOrdered,
} from "lucide-react";
import { GRID_LYRICS, setGridLyrics, useGridLyrics, type GridLyrics } from "#/lib/grid-lyrics";
import { useGridControls, type GridControls } from "#/lib/grid-controls";
import { useWordsOnScreen } from "#/lib/words-view";
import { setTrackColours, setTrackWaves, setTrackZoom, TRACK_ZOOMS, useTrackColours, useTrackWaves, useTrackZoom } from "#/lib/track-colours";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { ButtonGroup } from "@oneverse/ui/components/button-group";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle, DrawerTrigger } from "@oneverse/ui/components/drawer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@oneverse/ui/components/select";
import { useMediaQuery } from "@oneverse/ui/hooks/use-media-query";
import { useSidePanelRoom } from "#/lib/side-panel";
import { changeDiagramPlayer, changeDisplaySettings, stepTextSize } from "#/lib/display-settings";
import { TuningPicker } from "#/components/tuning-picker";
import { noteColorValue } from "#/components/notes";
import { useMarginCrowded } from "#/components/notes-overlay";
import { cn } from "@oneverse/ui/lib/utils";

const SECTIONS = ["grid", "words", "text", "chords", "instrument", "layout", "notes", "controls", "tracks"] as const;
type Section = (typeof SECTIONS)[number];
const SECTION_ICONS: Record<Section, LucideIcon> = { grid: Grid2x2, words: MicVocal, text: Type, chords: Music, instrument: Guitar, layout: Columns3, notes: MessageSquare, controls: PanelBottom, tracks: AudioLines };
/** Only Live has controls to lay out (issue #224); the Tracks view's look, where the page has it (issue #390); the chord grid's and the Words view's, while one is on screen (issues #408, #416). */
const sectionsFor = (mode: AppModeValue, tracks: boolean, grid: boolean, words: boolean) => SECTIONS.filter((one) => (one !== "controls" || mode === "LIVE") && (one !== "tracks" || tracks) && (one !== "grid" || grid) && (one !== "words" || words));

const KEY = "songverse.display.section";
/** From here the panel is a column down the right, every section in it (issue #209). */
const WIDE = "(min-width: 1024px)";

function keptSection(): Section {
  try {
    const kept = localStorage.getItem(KEY);
    return (SECTIONS as readonly string[]).includes(kept ?? "") ? (kept as Section) : "text";
  } catch {
    return "text";
  }
}

/**
 * The Display panel (issue #209): how charts read in this mode - text,
 * chords, the instrument's diagrams, the layout - in a small drawer at the
 * bottom that leaves the page usable behind it, so each change shows on the
 * chart as it's made. Saved for the mode (Edit, Practice or Live); the
 * instrument's tuning and hands are the account's, for every mode.
 */
export function DisplayPanel({
  mode,
  settings,
  player,
  className,
  compact = false,
  tracks = false,
  labelClassName,
}: {
  mode: AppModeValue;
  settings: EffectiveDisplaySettings;
  /** The account's diagram options (tunings, left-handed, piano). */
  player?: DiagramPlayer;
  className?: string;
  /** An icon only, for a crowded toolbar. */
  compact?: boolean;
  /** The page has a Tracks view (issue #390): its look, here too. */
  tracks?: boolean;
  /** Its label's classes: hidden on a phone, say (issue #390). */
  labelClassName?: string;
}) {
  const { t } = useTranslation();
  const [kept, setSection] = useState<Section>(keptSection);
  const grid = useGridControls();
  const words = useWordsOnScreen();
  const sections = sectionsFor(mode, tracks, !!grid, words);
  const [open, setOpen] = useState(false);
  // Opened over the chord grid or the Words view, it shows its section first (issues #408, #416); picked again, another.
  const [onView, setOnView] = useState(false);
  const section = onView && grid ? "grid" : onView && words ? "words" : sections.includes(kept) ? kept : "text";
  // A large screen has room for a column down the right with every section in it; a phone, the bottom.
  const wide = useMediaQuery(WIDE);
  const shown = (one: Section) => wide || section === one;
  // The page makes room for the column rather than going under it.
  useSidePanelRoom(open && wide);
  const modeName = t(`mode.${mode.toLowerCase()}`);
  const change = (next: Parameters<typeof changeDisplaySettings>[1]) => changeDisplaySettings(mode, next);

  function pick(next: Section) {
    setOnView(false);
    if (next === "grid" || next === "words") return setOnView(true);
    setSection(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked: for this page only.
    }
  }

  return (
    <Drawer
      modal={false}
      disablePointerDismissal
      open={open}
      onOpenChange={(next) => {
        if (next) setOnView(!!grid || words);
        setOpen(next);
      }}
      swipeDirection={wide ? "right" : "down"}
    >
      <DrawerTrigger
        render={<Button variant="outline" size={compact ? "icon" : "sm"} className={cn(compact && "size-8", className)} />}
        aria-label={t("display.open")}
        title={t("display.open")}
        data-testid="display-open"
      >
        <SlidersHorizontal aria-hidden />
        {compact ? null : <span className={labelClassName}>{t("display.open")}</span>}
      </DrawerTrigger>
      <DrawerContent side={wide ? "right" : "bottom"} data-testid="display-panel" data-mode={mode} aria-label={t("display.title")}>
        <div className={cn("flex items-center gap-2 border-b px-3 pb-2", wide && "pt-3")}>
          <DrawerTitle className={wide ? "flex items-center gap-2" : "sr-only"}>
            {wide ? <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden /> : null}
            {t("display.title")}
          </DrawerTitle>
          {wide ? null : (
            <Select value={section} onValueChange={(value) => value && pick(value as Section)}>
              <SelectTrigger className="h-8 w-auto min-w-36 font-medium" aria-label={t("display.section")} data-testid="display-section">
                <SelectValue>{(value: Section) => <SectionLabel section={value} />}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sections.map((value) => (
                  <SelectItem key={value} value={value} data-testid={`display-section-${value}`}>
                    <SectionLabel section={value} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" data-testid="display-mode">
            {t("display.forMode", { mode: modeName })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-8"
            onClick={() => change({ textSize: null, chordSize: null, font: null, spacing: null, columns: null, chordNotation: null, chordColors: null, capoDisplayMode: null, chordDiagrams: null, diagramsPosition: null, hideChords: null, bars: null, gridBarsPerRow: null, structureBar: null, wordsSize: null, wordsLayout: null, wordsLabels: null, wordsRepeats: null, wordsInstrumental: null, wordsNext: null, wordsSung: null, wordsFill: null, wordsChords: null, chordFont: null, chordWeight: null, chordColor: null, secondRow: null, controls: null, controlsPosition: null, hiddenControls: null, controlsOpacity: null, notes: null, noteMarks: null, newNotes: null, notesPlacement: null, notesLook: null, notesSize: null, notesColor: null })}
            title={t("display.resetHint", { mode: modeName })}
            aria-label={t("display.resetHint", { mode: modeName })}
            data-testid="display-reset"
          >
            <RotateCcw aria-hidden />
          </Button>
          <DrawerClose render={<Button variant="ghost" size="icon" className="size-8" />} aria-label={t("display.close")} data-testid="display-close">
            <X aria-hidden />
          </DrawerClose>
        </div>
        <div className={cn("flex flex-col gap-2 overflow-y-auto px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]", wide && "gap-5 pt-4")}>
          {grid && shown("grid") ? (
            <SectionBlock section="grid" heading={wide}>
              <GridSection mode={mode} settings={settings} grid={grid} onChange={change} onAction={() => (wide ? undefined : setOpen(false))} />
            </SectionBlock>
          ) : null}
          {words && shown("words") ? (
            <SectionBlock section="words" heading={wide}>
              <WordsSection mode={mode} settings={settings} onChange={change} />
            </SectionBlock>
          ) : null}
          {shown("text") ? (
            <SectionBlock section="text" heading={wide}>
              <Row label={t("display.lyricsSize")}>
                <SizeStepper
                  size={settings.textSize}
                  onChange={(textSize) => change({ textSize })}
                  smaller={t("display.smaller")}
                  bigger={t("display.bigger")}
                  testId="display"
                />
              </Row>
              <Row label={t("display.chordSize")}>
                <div className="flex min-w-0 items-center gap-1">
                  <SizeStepper
                    size={settings.chordSize}
                    // Set apart from the lyrics' from here on.
                    onChange={(chordSize) => change({ chordSize })}
                    smaller={t("display.chordsSmaller")}
                    bigger={t("display.chordsBigger")}
                    testId="display-chords"
                  />
                  <span className="flex w-9 shrink-0">
                  <Choice
                    pressed={settings.sizesLinked}
                    // Linked: the chords follow the lyrics again; unlinked: they keep the size they have now.
                    onClick={() => change({ chordSize: settings.sizesLinked ? settings.textSize : null })}
                    label={t("display.linkSizes")}
                    testId="display-link-sizes"
                  >
                    {settings.sizesLinked ? <Link2 /> : <Unlink2 />}
                  </Choice>
                  </span>
                </div>
              </Row>
              <Row label={t("display.font")}>
                <Choices
                  value={settings.font}
                  onChange={(font) => change({ font })}
                  name="font"
                  options={[
                    { value: "mono", label: t("display.fontMono"), content: <span className="font-mono">Aa</span> },
                    { value: "sans", label: t("display.fontSans"), content: <span className="font-sans">Aa</span> },
                  ]}
                />
              </Row>
              <Row label={t("display.spacing")}>
                <Choices
                  value={settings.spacing}
                  onChange={(spacing) => change({ spacing })}
                  name="spacing"
                  options={[
                    { value: "compact", label: t("display.spacingCompact"), content: <FoldVertical /> },
                    { value: "normal", label: t("display.spacingNormal"), content: <Rows3 /> },
                    { value: "relaxed", label: t("display.spacingRelaxed"), content: <UnfoldVertical /> },
                  ]}
                />
              </Row>
            </SectionBlock>
          ) : null}
          {shown("chords") ? (
            <SectionBlock section="chords" heading={wide}>
              <ChordRowControls
                row={settings.chordRows.main}
                name=""
                onChange={(next) =>
                  change({
                    ...(next.names && { chordNotation: next.names }),
                    ...(next.source && { capoDisplayMode: next.source }),
                    ...(next.font && { chordFont: next.font }),
                    ...(next.weight && { chordWeight: next.weight }),
                    ...(next.color && { chordColor: next.color, chordColors: null }),
                  })
                }
              />
              <Row label={t("display.show")}>
                <Choices
                  value={settings.hideChords ? "hidden" : "shown"}
                  onChange={(value) => change({ hideChords: value === "hidden" })}
                  name="chords"
                  options={[
                    { value: "shown", label: t("display.chordsShown"), content: <Eye /> },
                    { value: "hidden", label: t("display.chordsHidden"), content: <EyeOff /> },
                  ]}
                />
              </Row>
              <SecondRowControls settings={settings} onChange={change} />
              <Row label={t("display.bars")}>
                <Choices
                  value={settings.bars ? "shown" : "hidden"}
                  onChange={(value) => change({ bars: value === "shown" })}
                  name="bars"
                  options={[
                    { value: "shown", label: t("display.barsShown"), content: <Eye /> },
                    { value: "hidden", label: t("display.barsHidden"), content: <EyeOff /> },
                  ]}
                />
              </Row>
            </SectionBlock>
          ) : null}
          {shown("instrument") ? (
            <SectionBlock section="instrument" heading={wide}>
              <InstrumentSection settings={settings} player={player} onChange={(chordDiagrams) => change({ chordDiagrams })} onPosition={(diagramsPosition) => change({ diagramsPosition })} />
            </SectionBlock>
          ) : null}
          {shown("layout") ? (
            <SectionBlock section="layout" heading={wide}>
              <Row label={t("display.columns")}>
                <Choices
                  value={settings.columns}
                  onChange={(columns: DisplayColumnsValue) => change({ columns })}
                  name="columns"
                  options={[
                    { value: "auto", label: t("chart.columnsAuto"), content: <LayoutGrid /> },
                    { value: "1", label: t("chart.columnsCount", { count: 1 }), content: <RectangleVertical /> },
                    { value: "2", label: t("chart.columnsCount", { count: 2 }), content: <Columns2 /> },
                    { value: "3", label: t("chart.columnsCount", { count: 3 }), content: <Columns3 /> },
                  ]}
                />
              </Row>
            </SectionBlock>
          ) : null}
          {sections.includes("notes") && shown("notes") ? (
            <SectionBlock section="notes" heading={wide}>
              {/* Ready-made ways notes show (issue #264), each a start to change. */}
              <NotePresets style={settings.noteStyle} onChange={change} />
              {/* Notes on the chart (issue #256): every note, one's own, or none - each mode its own. */}
              <Row label={t("display.notesShow")}>
                <Choices
                  value={settings.notes}
                  onChange={(notes) => change({ notes })}
                  name="notes"
                  options={[
                    { value: "ALL", label: t("display.notesAll"), content: <MessageSquare /> },
                    { value: "MINE", label: t("display.notesMine"), content: <UserRound /> },
                    { value: "NONE", label: t("display.notesNone"), content: <MessageSquareOff /> },
                  ]}
                />
              </Row>
              {/* What each note is on, marked on the chart (issue #263). */}
              <Row label={t("display.noteMarks")}>
                <Choices
                  value={settings.noteMarks ? "on" : "off"}
                  onChange={(value) => change({ noteMarks: value === "on" })}
                  name="noteMarks"
                  options={[
                    { value: "on", label: t("display.noteMarksOn"), content: <Highlighter /> },
                    { value: "off", label: t("display.noteMarksOff"), content: <EyeOff /> },
                  ]}
                />
              </Row>
              {/* Someone else's new notes in Live: held until a tap, or at once (issue #263). */}
              {mode === "LIVE" ? (
                <Row label={t("display.newNotes")}>
                  <Choices
                    value={settings.newNotes}
                    onChange={(newNotes) => change({ newNotes })}
                    name="newNotes"
                    options={[
                      { value: "HOLD", label: t("display.newNotesHold"), content: <Hand /> },
                      { value: "SHOW", label: t("display.newNotesShow"), content: <Zap /> },
                    ]}
                  />
                </Row>
              ) : null}
              {/* Where notes go, and how they look (issue #264). */}
              <Row label={t("display.notesPlacement")}>
                <Choices
                  value={settings.noteStyle.placement}
                  onChange={(notesPlacement) => change({ notesPlacement })}
                  name="notesPlacement"
                  options={[
                    { value: "below", label: t("display.notesBelow"), content: t("display.notesBelow") },
                    { value: "beside", label: t("display.notesBeside"), content: t("display.notesBeside") },
                    { value: "margin", label: t("display.notesMargin"), content: t("display.notesMargin") },
                  ]}
                />
              </Row>
              {settings.noteStyle.placement === "margin" ? <MarginRoom /> : null}
              <Row label={t("display.notesLook")}>
                <Choices
                  value={settings.noteStyle.look}
                  onChange={(notesLook) => change({ notesLook })}
                  name="notesLook"
                  options={[
                    { value: "card", label: t("display.notesCard"), content: t("display.notesCard") },
                    { value: "minimal", label: t("display.notesMinimal"), content: t("display.notesMinimal") },
                    { value: "plain", label: t("display.notesPlain"), content: t("display.notesPlain") },
                  ]}
                />
              </Row>
              <Row label={t("display.notesSize")}>
                <Choices
                  value={settings.noteStyle.size}
                  onChange={(notesSize) => change({ notesSize })}
                  name="notesSize"
                  options={[
                    { value: "S", label: t("display.notesSmall"), content: <span className="text-[0.7rem]">A</span> },
                    { value: "M", label: t("display.notesMedium"), content: <span className="text-xs">A</span> },
                    { value: "L", label: t("display.notesLarge"), content: <span className="text-base">A</span> },
                  ]}
                />
              </Row>
              <Row label={t("display.notesColor")}>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("display.notesColor")}>
                  {NOTE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={settings.noteStyle.color === color}
                      aria-label={t(`display.noteColors.${color}`)}
                      title={t(`display.noteColors.${color}`)}
                      onClick={() => change({ notesColor: color })}
                      className={cn("size-7 rounded-full border-2", settings.noteStyle.color === color ? "border-foreground" : "border-transparent")}
                      style={{ backgroundColor: noteColorValue(color) }}
                      data-testid={`display-notesColor-${color}`}
                    />
                  ))}
                </div>
              </Row>
            </SectionBlock>
          ) : null}
          {sections.includes("tracks") && shown("tracks") ? (
            <SectionBlock section="tracks" heading={wide}>
              <TracksSection />
            </SectionBlock>
          ) : null}
          {sections.includes("controls") && shown("controls") ? (
            <SectionBlock section="controls" heading={wide}>
              <ControlsSection settings={settings} onChange={change} />
            </SectionBlock>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * The chord grid's section (issue #408): its bars a row and its words, and
 * Loop bars and Edit bars, which close the
 * drawer on a phone so the bars can be tapped.
 */
function GridSection({ mode, settings, grid, onChange, onAction }: { mode: AppModeValue; settings: EffectiveDisplaySettings; grid: GridControls; onChange: (change: Parameters<typeof changeDisplaySettings>[1]) => void; onAction: () => void }) {
  const { t } = useTranslation();
  const lyrics = useGridLyrics();
  return (
    <>
      <Row label={t("display.gridBarsPerRow")}>
        <Choices
          value={settings.gridBarsPerRow}
          onChange={(gridBarsPerRow) => onChange({ gridBarsPerRow })}
          name="gridBarsPerRow"
          options={[
            { value: "auto", label: t("display.gridBarsAutoHint"), content: t("display.gridBarsAuto") },
            { value: "1", label: t("display.gridBarsCount", { count: 1 }), content: "1" },
            { value: "2", label: t("display.gridBarsCount", { count: 2 }), content: "2" },
            { value: "4", label: t("display.gridBarsCount", { count: 4 }), content: "4" },
          ]}
        />
      </Row>
      <Row label={t("chordGrid.lyrics")}>
        <Choices<GridLyrics>
          value={lyrics}
          onChange={setGridLyrics}
          name="gridLyrics"
          options={GRID_LYRICS.map((choice) => ({ value: choice, label: t(`chordGrid.lyricsChoice.${choice}`), content: t(`display.gridLyricsShort.${choice}`) }))}
        />
      </Row>
      <SectionsBarRow mode={mode} settings={settings} onChange={onChange} />
      {grid.canLoop || grid.looped || grid.canEdit ? (
        <div className="mt-1 grid grid-cols-2 gap-2 border-t pt-2">
          {grid.canLoop || grid.looped ? (
            <Button
              type="button"
              variant={grid.looped || grid.choosingLoop ? "secondary" : "outline"}
              className="h-auto flex-col items-start gap-0 py-1.5 text-left whitespace-normal"
              aria-pressed={!!grid.looped}
              onClick={() => {
                grid.loop();
                if (!grid.looped && !grid.choosingLoop) onAction();
              }}
              data-testid="chord-grid-loop"
            >
              <span className="flex items-center gap-1.5">
                {grid.looped ? <Square /> : <Repeat />}
                {grid.looped ? t("chordGrid.stopLoop") : t("chordGrid.loop")}
              </span>
              <span className="text-[11px] font-normal text-muted-foreground">{grid.looped ? t("chordGrid.looping", { first: grid.looped.first + 1, last: grid.looped.last + 1 }) : t("chordGrid.loopHint")}</span>
            </Button>
          ) : null}
          {grid.canEdit ? (
            <Button
              type="button"
              variant="outline"
              className="h-auto flex-col items-start gap-0 py-1.5 text-left whitespace-normal"
              disabled={grid.editing}
              onClick={() => {
                grid.edit();
                onAction();
              }}
              data-testid="chord-grid-edit-start"
            >
              <span className="flex items-center gap-1.5">
                <Pencil />
                {t("chordGrid.edit")}
              </span>
              <span className="text-[11px] font-normal text-muted-foreground">{t("chordGrid.editShort")}</span>
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("chordGrid.tapHint")}</p>
    </>
  );
}

/**
 * The sections bar over the grid and the words (issue #416): in Live, its
 * structure bar - one of its controls, the same switch as in Controls.
 */
function SectionsBarRow({ mode, settings, onChange }: { mode: AppModeValue; settings: EffectiveDisplaySettings; onChange: (change: Parameters<typeof changeDisplaySettings>[1]) => void }) {
  const { t } = useTranslation();
  const live = mode === "LIVE";
  const on = live ? !settings.hiddenControls.includes("structure") : settings.structureBar;
  const set = (next: boolean) =>
    live ? onChange({ hiddenControls: next ? settings.hiddenControls.filter((one) => one !== "structure") : [...settings.hiddenControls, "structure"] }) : onChange({ structureBar: next });
  return (
    <Row label={t("display.sectionsBar")}>
      <Choices
        value={on ? "shown" : "hidden"}
        onChange={(value) => set(value === "shown")}
        name="sectionsBar"
        options={[
          { value: "shown", label: t("display.sectionsBarShown"), content: <ListOrdered /> },
          { value: "hidden", label: t("display.sectionsBarHidden"), content: <EyeOff /> },
        ]}
      />
    </Row>
  );
}

/** The Words view's section (issue #416): how the words read for a singer. */
function WordsSection({ mode, settings, onChange }: { mode: AppModeValue; settings: EffectiveDisplaySettings; onChange: (change: Parameters<typeof changeDisplaySettings>[1]) => void }) {
  const { t } = useTranslation();
  const words = settings.words;
  const onOff = (value: boolean) => (value ? "on" : "off");
  const both = (name: string, value: boolean, change: (value: boolean) => void, on: string, off: string) => (
    <Choices
      value={onOff(value)}
      onChange={(next) => change(next === "on")}
      name={name}
      options={[
        { value: "on", label: on, content: on },
        { value: "off", label: off, content: off },
      ]}
    />
  );
  return (
    <>
      <Row label={t("display.wordsSize")}>
        <SizeStepper size={words.size} onChange={(wordsSize) => onChange({ wordsSize })} smaller={t("display.smaller")} bigger={t("display.bigger")} testId="display-words" />
      </Row>
      <Row label={t("display.wordsLayout")}>
        <Choices
          value={words.layout}
          onChange={(wordsLayout) => onChange({ wordsLayout })}
          name="wordsLayout"
          options={[
            { value: "scroll", label: t("display.wordsLayoutScroll"), content: t("display.wordsLayoutScroll") },
            { value: "lines", label: t("display.wordsLayoutLines"), content: t("display.wordsLayoutLines") },
          ]}
        />
      </Row>
      <Row label={t("display.wordsLabels")}>
        <Choices
          value={words.labels}
          onChange={(wordsLabels) => onChange({ wordsLabels })}
          name="wordsLabels"
          options={(["badge", "heading", "hidden"] as const).map((value) => ({ value, label: t(`display.wordsLabelsChoice.${value}`), content: t(`display.wordsLabelsChoice.${value}`) }))}
        />
      </Row>
      <Row label={t("display.wordsRepeats")}>
        <Choices
          value={words.repeats}
          onChange={(wordsRepeats) => onChange({ wordsRepeats })}
          name="wordsRepeats"
          options={[
            { value: "written", label: t("display.wordsRepeatsWrittenHint"), content: t("display.wordsRepeatsWritten") },
            { value: "once", label: t("display.wordsRepeatsOnceHint"), content: t("display.wordsRepeatsOnce") },
          ]}
        />
      </Row>
      <Row label={t("display.wordsInstrumental")}>{both("wordsInstrumental", words.instrumental, (wordsInstrumental) => onChange({ wordsInstrumental }), t("display.wordsInstrumentalShown"), t("display.hidden"))}</Row>
      <Row label={t("display.wordsNext")}>{both("wordsNext", words.next, (wordsNext) => onChange({ wordsNext }), t("display.wordsNextShown"), t("display.hidden"))}</Row>
      <Row label={t("display.wordsSung")}>
        <Choices
          value={words.sung}
          onChange={(wordsSung) => onChange({ wordsSung })}
          name="wordsSung"
          options={[
            { value: "dim", label: t("display.wordsSungDim"), content: t("display.wordsSungDim") },
            { value: "hide", label: t("display.hidden"), content: t("display.hidden") },
          ]}
        />
      </Row>
      <Row label={t("display.wordsFill")}>{both("wordsFill", words.fill, (wordsFill) => onChange({ wordsFill }), t("display.on"), t("display.off"))}</Row>
      <Row label={t("display.wordsChords")}>{both("wordsChords", words.chords, (wordsChords) => onChange({ wordsChords }), t("display.wordsChordsSmall"), t("display.hidden"))}</Row>
      <SectionsBarRow mode={mode} settings={settings} onChange={onChange} />
      <p className="text-xs text-muted-foreground">{t("display.wordsHint")}</p>
    </>
  );
}

/** Live's controls (issue #224): a footer, floating buttons or none; which show; how opaque floating ones are. */
function ControlsSection({ settings, onChange }: { settings: EffectiveDisplaySettings; onChange: (change: Parameters<typeof changeDisplaySettings>[1]) => void }) {
  const { t } = useTranslation();
  const hidden = new Set(settings.hiddenControls);
  const opacity = Math.round(settings.controlsOpacity * 100);
  return (
    <>
      <Row label={t("display.controlsLayout")}>
        <Choices
          value={settings.controls}
          onChange={(controls) => onChange({ controls })}
          name="controls"
          options={[
            { value: "footer", label: t("display.controlsFooter"), content: <PanelBottom /> },
            { value: "floating", label: t("display.controlsFloating"), content: <CircleDot /> },
            { value: "hidden", label: t("display.controlsHidden"), content: <EyeOff /> },
          ]}
        />
      </Row>
      {settings.controls === "floating" ? (
        <>
          <Row label={t("display.controlsPosition")}>
            <Choices
              value={settings.controlsPosition}
              onChange={(controlsPosition) => onChange({ controlsPosition })}
              name="controls-position"
              options={CONTROLS_POSITIONS.map((value) => ({ value, label: t(`display.positions.${value}`), content: <PositionIcon position={value} /> }))}
            />
          </Row>
          <Row label={t("display.controlsOpacity")}>
            <span className="flex min-w-0 items-center gap-2">
              <input
                type="range"
                min={20}
                max={100}
                step={10}
                value={opacity}
                onChange={(event) => onChange({ controlsOpacity: Number(event.target.value) / 100 })}
                aria-label={t("display.controlsOpacity")}
                className="min-w-0 flex-1 accent-primary"
                data-testid="display-controls-opacity"
              />
              <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{opacity}%</span>
            </span>
          </Row>
        </>
      ) : null}
      {settings.controls === "hidden" ? <p className="text-xs text-muted-foreground">{t("display.controlsHiddenHint")}</p> : (
        <div className="flex flex-col gap-1" role="group" aria-label={t("display.controlsShown")}>
          <span className="text-xs text-muted-foreground">{t("display.controlsShown")}</span>
          <div className="grid grid-cols-2 gap-1">
            {LIVE_CONTROLS.map((control) => (
              <Choice
                key={control}
                pressed={!hidden.has(control)}
                onClick={() => onChange({ hiddenControls: hidden.has(control) ? settings.hiddenControls.filter((one) => one !== control) : [...settings.hiddenControls, control] })}
                label={t(`display.liveControls.${control}`)}
                testId={`display-control-${control}`}
              >
                <span className="truncate">{t(`display.liveControls.${control}`)}</span>
              </Choice>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A row of chords' options (issue #230): its names (a notation, or a
 * diagram on each chord), the chord it names, and its look. The same for
 * the main row and the second; `name` tells their buttons apart.
 */
function ChordRowControls({ row, name, onChange }: { row: ChordRow; name: string; onChange: (change: Partial<ChordRow>) => void }) {
  const { t } = useTranslation();
  const id = (field: string) => (name ? `${name}-${field}` : field);
  const custom = row.color.startsWith("#");
  return (
    <>
      <Row label={t("display.names")}>
        <Choices
          value={row.names}
          onChange={(names) => onChange({ names })}
          name={id("notation")}
          options={[
            { value: "LETTERS", label: t("dashboard.notationLetters"), content: "C" },
            { value: "SOLFEGE", label: t("player.solfege"), content: "Do" },
            { value: "NASHVILLE", label: t("dashboard.notationNashville"), content: "1" },
            { value: "ROMAN", label: t("dashboard.notationRoman"), content: "I" },
          ]}
        />
      </Row>
      <Row label={t("display.capo")}>
        <Choices
          value={row.source}
          onChange={(source) => onChange({ source })}
          name={id("capo")}
          options={[
            { value: "SOUNDING", label: t("display.capoSounding"), content: <Ear /> },
            { value: "FINGERED", label: t("display.capoShapes"), content: <Hand /> },
          ]}
        />
      </Row>
      <Row label={t("display.color")}>
        <span className="flex min-w-0 items-center gap-1">
          <Choices
            value={custom ? "custom" : (row.color as "theme" | "muted" | "family")}
            onChange={(color) => onChange({ color: color === "custom" ? "#e11d48" : color })}
            name={id("color")}
            options={[
              { value: "theme", label: t("display.colorTheme"), content: <span className="size-3 rounded-full border-2 border-current bg-primary" /> },
              { value: "muted", label: t("display.colorMuted"), content: <span className="size-3 rounded-full border-2 border-current bg-muted-foreground" /> },
              { value: "family", label: t("display.colorsOn"), content: <Palette /> },
              { value: "custom", label: t("display.colorCustom"), content: <span className="size-3 rounded-full" style={{ background: custom ? row.color : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }} /> },
            ]}
          />
          {custom ? (
            <input
              type="color"
              value={row.color}
              onChange={(event) => onChange({ color: event.target.value })}
              aria-label={t("display.colorCustom")}
              className="size-8 shrink-0 cursor-pointer rounded-md border bg-background p-0.5"
              data-testid={`display-${id("color-pick")}`}
            />
          ) : null}
        </span>
      </Row>
      <Row label={t("display.font")}>
        <Choices
          value={row.font}
          onChange={(font) => onChange({ font })}
          name={id("chord-font")}
          options={[
            { value: "same", label: t("display.fontSame"), content: "=" },
            { value: "sans", label: t("display.fontSans"), content: <span className="font-sans">Aa</span> },
            { value: "mono", label: t("display.fontMono"), content: <span className="font-mono">Aa</span> },
          ]}
        />
      </Row>
      <Row label={t("display.weight")}>
        <Choices
          value={row.weight}
          onChange={(weight) => onChange({ weight })}
          name={id("weight")}
          options={[
            { value: "bold", label: t("display.weightBold"), content: <span className="font-bold">B</span> },
            { value: "normal", label: t("display.weightNormal"), content: <span className="font-normal">B</span> },
          ]}
        />
      </Row>
    </>
  );
}

/**
 * The second row of chords (issue #230): off unless turned on - off, it
 * keeps its settings for when it's on again - where it goes (under, over,
 * a superscript, side by side), the gap between the rows, its size, and a
 * row's options.
 */
function SecondRowControls({ settings, onChange }: { settings: EffectiveDisplaySettings; onChange: (change: Parameters<typeof changeDisplaySettings>[1]) => void }) {
  const { t } = useTranslation();
  const second = settings.chordRows.second;
  const kept = settings.secondRowKept;
  const set = (change: Partial<SecondChordRow>) => onChange({ secondRow: { ...kept, ...(second ?? {}), ...change, on: true } });
  const step = <T extends number>(values: readonly T[], value: number, by: 1 | -1) => values[Math.min(values.length - 1, Math.max(0, values.indexOf(value as T) + by))]!;
  const stepper = (field: "size" | "gap", values: readonly number[], shown: string, labels: [string, string]) => {
    const value = second![field];
    const at = values.indexOf(value);
    return (
      <ButtonGroup className="w-full">
        <Choice pressed={false} disabled={at <= 0} onClick={() => set({ [field]: step(values, value, -1) })} label={labels[0]} testId={`display-second-${field}-smaller`}>
          <Minus />
        </Choice>
        <span className="flex flex-1 items-center justify-center border-y bg-background text-xs font-medium tabular-nums" data-testid={`display-second-${field}`}>
          {shown}
        </span>
        <Choice pressed={false} disabled={at >= values.length - 1} onClick={() => set({ [field]: step(values, value, 1) })} label={labels[1]} testId={`display-second-${field}-bigger`}>
          <Plus />
        </Choice>
      </ButtonGroup>
    );
  };
  return (
    <div className="mt-1 flex flex-col gap-2 border-t pt-2" data-testid="display-second-row">
      <Row label={t("display.secondRow")}>
        <Choices
          value={second ? "on" : "off"}
          // Off keeps what it was set to; on brings it back (Roman numerals the first time).
          onChange={(value) => onChange({ secondRow: { names: "ROMAN", ...kept, on: value === "on" } })}
          name="second"
          options={[
            { value: "off", label: t("display.secondOff"), content: <Minus /> },
            { value: "on", label: t("display.secondOn"), content: <Layers2 /> },
          ]}
        />
      </Row>
      {second ? (
        <>
          <Row label={t("display.position")}>
            <Choices
              value={second.position}
              onChange={(position) => set({ position })}
              name="second-position"
              options={[
                { value: "below", label: t("display.positionBelow"), content: <ArrowDownToLine /> },
                { value: "above", label: t("display.positionAbove"), content: <ArrowUpToLine /> },
                { value: "beside", label: t("display.positionBeside"), content: <Superscript /> },
                { value: "right", label: t("display.positionRight"), content: <ArrowRightToLine /> },
                { value: "left", label: t("display.positionLeft"), content: <ArrowLeftToLine /> },
              ]}
            />
          </Row>
          <Row label={t("display.rowGap")}>{stepper("gap", SECOND_ROW_GAPS, `${second.gap}`, [t("display.rowGapSmaller"), t("display.rowGapBigger")])}</Row>
          <Row label={t("display.rowSize")}>{stepper("size", SECOND_ROW_SIZES, `${Math.round(second.size * 100)}%`, [t("display.rowSmaller"), t("display.rowBigger")])}</Row>
          <ChordRowControls row={second} name="second" onChange={(change) => set(change)} />
        </>
      ) : null}
    </div>
  );
}

/** Where floating controls sit, as an arrow towards it. */
function PositionIcon({ position }: { position: ControlsPositionValue }) {
  const Icon = { "bottom-right": ArrowDownRight, "bottom-left": ArrowDownLeft, "bottom-center": ArrowDown, right: ArrowRight }[position];
  return <Icon />;
}

/** A section of the panel: under its heading when they're all shown at once. */
/** The sections folded away on a large screen (issue #265), remembered on the device. */
const FOLDED_KEY = "songverse.display.folded";
function foldedSections(): Section[] {
  try {
    const kept = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]") as unknown;
    return Array.isArray(kept) ? kept.filter((one): one is Section => (SECTIONS as readonly string[]).includes(one)) : [];
  } catch {
    return [];
  }
}

/** The Tracks view's look (issue #390): kept on the device, as its own buttons keep it. */
function TracksSection() {
  const { t } = useTranslation();
  const coloured = useTrackColours();
  const waves = useTrackWaves();
  const zoom = useTrackZoom();
  return (
    <>
      <Row label={t("display.trackColours")}>
        <Choices
          value={coloured ? "on" : "off"}
          onChange={(value) => setTrackColours(value === "on")}
          name="track-colours"
          options={[
            { value: "on", label: t("tracks.colours"), content: <Palette /> },
            { value: "off", label: t("display.trackOneColour"), content: <CircleDot /> },
          ]}
        />
      </Row>
      <Row label={t("display.trackWaves")}>
        <Choices
          value={waves}
          onChange={setTrackWaves}
          name="track-waves"
          options={[
            { value: "filled", label: t("display.trackFilled"), content: t("display.trackFilled") },
            { value: "lines", label: t("tracks.lines"), content: t("display.trackLines") },
          ]}
        />
      </Row>
      <Row label={t("display.trackShown")}>
        <Choices
          value={zoom}
          onChange={setTrackZoom}
          name="track-zoom"
          options={TRACK_ZOOMS.map((value) => ({ value, label: value === "song" ? t("tracks.wholeSong") : t("tracks.seconds", { count: Number(value) }), content: value === "song" ? t("display.trackWholeSong") : `${value} s` }))}
        />
      </Row>
    </>
  );
}

/** A section of the panel; on a large screen, under a heading that folds it away and opens it again. */
function SectionBlock({ section, heading, children }: { section: Section; heading: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const [folded, setFolded] = useState(() => heading && foldedSections().includes(section));
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    try {
      const others = foldedSections().filter((one) => one !== section);
      localStorage.setItem(FOLDED_KEY, JSON.stringify(next ? [...others, section] : others));
    } catch {
      // Not kept: it's only for this device anyway.
    }
  };
  const shut = heading && folded;
  return (
    <section className="flex flex-col gap-2" data-testid={`display-block-${section}`} data-folded={shut ? "" : undefined}>
      {heading ? (
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!shut}
            aria-label={t(shut ? "display.unfold" : "display.fold", { section: t(`display.${section}`) })}
            className="-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between rounded px-1 py-0.5 uppercase hover:bg-muted hover:text-foreground"
            data-testid={`display-fold-${section}`}
          >
            <SectionLabel section={section} />
            <ChevronDown className={cn("size-4 transition-transform", shut && "-rotate-90")} aria-hidden />
          </button>
        </h3>
      ) : null}
      {shut ? null : children}
    </section>
  );
}

/** Margin chosen, but no room for it beside the chart right now (issue #266). */
function MarginRoom() {
  const { t } = useTranslation();
  if (!useMarginCrowded()) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="display-notes-margin-crowded">
      {t("display.notesMarginCrowded")}
    </p>
  );
}

function SectionLabel({ section }: { section: Section }) {
  const { t } = useTranslation();
  const Icon = SECTION_ICONS[section];
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {t(`display.${section}`)}
    </span>
  );
}

function InstrumentSection({
  settings,
  player,
  onChange,
  onPosition,
}: {
  settings: EffectiveDisplaySettings;
  player?: DiagramPlayer;
  onChange: (value: ChordDiagramsValue) => void;
  onPosition: (value: DiagramPositionValue) => void;
}) {
  const { t } = useTranslation();
  const fretted = settings.chordDiagrams === "GUITAR" || settings.chordDiagrams === "UKULELE";
  const instrument = settings.chordDiagrams === "UKULELE" ? "ukulele" : "guitar";
  const tuning = (instrument === "ukulele" ? player?.ukuleleTuning : player?.guitarTuning) ?? "standard";
  return (
    <>
      <Row label={t("display.diagrams")}>
        <Choices
          value={settings.chordDiagrams}
          onChange={onChange}
          name="diagrams"
          options={[
            { value: "OFF", label: t("dashboard.diagramsOff"), content: t("dashboard.diagramsOff") },
            { value: "GUITAR", label: t("dashboard.diagramsGuitar"), content: t("dashboard.diagramsGuitar") },
            { value: "UKULELE", label: t("dashboard.diagramsUkulele"), content: t("dashboard.diagramsUkulele") },
            { value: "PIANO", label: t("dashboard.diagramsPiano"), content: t("dashboard.diagramsPiano") },
          ]}
        />
      </Row>
      {settings.chordDiagrams !== "OFF" ? (
        <Row label={t("display.diagramsPosition")}>
          <Choices
            value={settings.diagramsPosition}
            onChange={onPosition}
            name="diagrams-position"
            options={[
              { value: "hidden", label: t("display.diagramsHidden"), content: <EyeOff /> },
              { value: "top", label: t("display.diagramsTop"), content: <PanelTop /> },
              { value: "bottom", label: t("display.diagramsBottom"), content: <PanelBottom /> },
              { value: "sections", label: t("display.diagramsSections"), content: <PanelRight /> },
            ]}
          />
        </Row>
      ) : null}
      {fretted ? (
        <>
          <Row label={t("display.tuning")}>
            <TuningPicker
              instrument={instrument}
              value={tuning}
              compact
              onChange={(next) => changeDiagramPlayer(instrument === "ukulele" ? { ukuleleTuning: next ?? "standard" } : { guitarTuning: next ?? "standard" })}
              testId="display-tuning"
              className="w-full"
            />
          </Row>
          <Row label={t("display.leftHanded")}>
            <Choices
              value={player?.leftHanded ? "yes" : "no"}
              onChange={(value) => changeDiagramPlayer({ leftHanded: value === "yes" })}
              name="left-handed"
              options={[
                { value: "no", label: t("dashboard.leftHandedNo"), content: t("dashboard.leftHandedNo") },
                { value: "yes", label: t("dashboard.leftHandedYes"), content: t("dashboard.leftHandedYes") },
              ]}
            />
          </Row>
        </>
      ) : null}
      {settings.chordDiagrams === "PIANO" ? (
        <Row label={t("display.hands")}>
          <Choices
            value={player?.pianoHands === "right" ? "right" : "both"}
            onChange={(pianoHands) => changeDiagramPlayer({ pianoHands })}
            name="hands"
            options={[
              { value: "both", label: t("dashboard.pianoBoth"), content: t("display.handsBoth") },
              { value: "right", label: t("dashboard.pianoRight"), content: t("display.handsRight") },
            ]}
          />
        </Row>
      ) : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** A size, a step down or up the scale at a time, as a percentage. */
function SizeStepper({ size, onChange, smaller, bigger, testId }: { size: number; onChange: (size: number) => void; smaller: string; bigger: string; testId: string }) {
  return (
    <ButtonGroup className="w-full">
      <Choice pressed={false} disabled={size <= DISPLAY_TEXT_SIZES[0]!} onClick={() => onChange(stepTextSize(size, -1))} label={smaller} testId={`${testId}-smaller`}>
        <Minus />
      </Choice>
      <span className="flex flex-1 items-center justify-center border-y bg-background text-xs font-medium tabular-nums" data-testid={`${testId}-size`}>
        {Math.round(size * 100)}%
      </span>
      <Choice pressed={false} disabled={size >= DISPLAY_TEXT_SIZES[DISPLAY_TEXT_SIZES.length - 1]!} onClick={() => onChange(stepTextSize(size, 1))} label={bigger} testId={`${testId}-bigger`}>
        <Plus />
      </Choice>
    </ButtonGroup>
  );
}

/** One of a few, side by side; each with its name as a tooltip when it shows an icon. */
function Choices<T extends string>({ value, onChange, options, name }: { value: T; onChange: (value: T) => void; options: { value: T; label: string; content: ReactNode }[]; name: string }) {
  return (
    <ButtonGroup className="w-full">
      {options.map((option) => (
        <Choice key={option.value} pressed={value === option.value} onClick={() => onChange(option.value)} label={option.label} testId={`display-${name}-${option.value}`}>
          {option.content}
        </Choice>
      ))}
    </ButtonGroup>
  );
}

function Choice({ pressed, onClick, label, testId, disabled, children }: { pressed: boolean; onClick: () => void; label: string; testId: string; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex h-8 min-w-0 flex-1 items-center justify-center gap-1 truncate rounded-md border px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
        pressed ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** The note presets (issue #264): one tap sets where notes go and how they look; "Custom" once one of them is changed. */
function NotePresets({ style, onChange }: { style: NoteStyle; onChange: (changes: { notesPlacement: NotePlacement; notesLook: NoteLook; notesSize: NoteSize; notesColor: NoteColor }) => void }) {
  const { t } = useTranslation();
  const current = notePresetOf(style);
  return (
    <Row label={t("display.notesPreset")}>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("display.notesPreset")}>
        {(Object.keys(NOTE_PRESETS) as NotePreset[]).map((name) => {
          const preset = NOTE_PRESETS[name];
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={current === name}
              onClick={() => onChange({ notesPlacement: preset.placement, notesLook: preset.look, notesSize: preset.size, notesColor: preset.color })}
              className={cn(
                "h-8 rounded-md border px-2.5 text-xs font-medium",
                current === name ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              data-testid={`display-notesPreset-${name}`}
            >
              {t(`display.notePresets.${name}`)}
            </button>
          );
        })}
        {current ? null : <span className="self-center px-1 text-xs text-muted-foreground" data-testid="display-notesPreset-custom">{t("display.notePresets.custom")}</span>}
      </div>
    </Row>
  );
}
