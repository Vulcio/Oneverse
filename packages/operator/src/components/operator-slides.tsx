import { passName, slideKey, type RenderedChart, type ScreenSlide, type SetlistOfflineCopy, type SetlistSongView, type SongNote, type TeamMember, type TeamPosition } from "@oneverse/core";
import { ChevronLeft, ChevronRight, MonitorOff, RotateCcw, SlidersHorizontal, Square } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Kbd } from "@oneverse/ui/components/kbd";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { cn } from "@oneverse/ui/lib/utils";
import { setItemView } from "@oneverse/screen/lib/set-items";
import { useLive, useOperatorHost } from "../host";
import {
  changeOperatorDisplay,
  OPERATOR_COLUMNS,
  OPERATOR_FONTS,
  OPERATOR_SCREEN_VIEWS,
  OPERATOR_SECTION_COLORS,
  OPERATOR_SIZES,
  OPERATOR_TILES,
  resetOperatorDisplay,
  useOperatorDisplay,
  type OperatorDisplay,
} from "../lib/display-options";
import type { OperatorItem } from "./operator-rundown";

/** The slides' lettering (issue #358): the app's, a serif, a monospace, or a narrow one that fits more words to a tile. */
const FONT_FAMILY: Record<OperatorDisplay["font"], string> = {
  sans: "var(--font-sans)",
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: "var(--font-mono)",
  condensed: '"Roboto Condensed", "Arial Narrow", "Helvetica Neue Condensed", "Liberation Sans Narrow", sans-serif-condensed, sans-serif',
};
const TEXT_SIZE: Record<OperatorDisplay["size"], string> = { s: "text-xs", m: "text-sm", l: "text-base", xl: "text-lg" };
const TILE_HEIGHT: Record<OperatorDisplay["size"], string> = { s: "min-h-16", m: "min-h-24", l: "min-h-28", xl: "min-h-32" };

/**
 * An item's slides as tiles (issues #275, #358), the one on the screens
 * picked out: a tile sends its slide. How they look is this device's
 * Display options: lettering, size, capitals, the section's colour on the
 * whole tile or its header, grouped by section, slides to a row, numbers,
 * light or dark. Its notes beside them, if asked: all, or those written by
 * people holding one of the team's positions.
 */
export function SlidesTab({ copy, view, item, members, positions }: { copy: SetlistOfflineCopy; view: SetlistSongView | null; item: OperatorItem | null; members: TeamMember[]; positions: TeamPosition[] }) {
  const { t } = useTranslation();
  const { session, canPresent } = useLive();
  const { present: presentScreens } = useOperatorHost();
  const display = useOperatorDisplay();
  const presenting = session?.presenting ?? null;
  const [notesShown, setNotesShown] = useState(false);
  const [position, setPosition] = useState("");
  // A song's chart and lyrics, a text's paragraphs (issue #305), or a passage's verses (issue #301).
  const { chart, slides } = useMemo(() => (item ? item : view ? setItemView(view) : { chart: null, slides: [] }), [item, view]);
  if (!view || (!view.song && !view.text && !view.passage)) return <p className="text-sm text-muted-foreground">{t("screens.operator.noSong")}</p>;
  if (view.passage && slides.length === 0) return <p className="text-sm text-muted-foreground" data-testid="operator-passage-hidden">{t(view.passage.projection ? "sets.passage.missing" : "sets.passage.notProjected")}</p>;
  const itemId = view.item.id;
  const here = presenting?.itemId === itemId ? presenting.slide : null;
  const send = (slide: number) => presentScreens({ itemId, slide, black: false, slideKey: item?.key ?? slideKey(slides) });
  const sections = item?.sections ?? [];
  // The notes (issue #275): those on the song, filtered by their writers' team position.
  const holders = new Set(position ? members.filter((member) => member.positionIds?.includes(position)).map((member) => member.userId) : []);
  const notes = notesShown && view.song ? (copy.notes[view.song.id]?.notes ?? []).filter((note) => !note.resolved && (!position || holders.has(note.author.id))) : [];
  const notesFor = (passIndex: number): SongNote[] => {
    const pass = chart?.passes[passIndex];
    if (!pass) return [];
    return notes.filter((note) => note.anchor.kind !== "song" && ("passId" in note.anchor && note.anchor.passId ? note.anchor.passId === pass.id : "sectionId" in note.anchor && note.anchor.sectionId === pass.section.id));
  };
  const songNotes = notes.filter((note) => note.anchor.kind === "song");
  // Each pass's slides together (grouped), or one run of tiles.
  const groups: { passIndex: number; from: number; to: number }[] = [];
  slides.forEach((slide, index) => {
    const last = groups[groups.length - 1];
    if (display.grouped && last && slides[index - 1]!.passIndex === slide.passIndex) last.to = index + 1;
    else if (display.grouped || !last) groups.push({ passIndex: slide.passIndex, from: index, to: index + 1 });
    else last.to = index + 1;
  });
  const gridStyle: CSSProperties | undefined = display.columns === "auto" ? undefined : { gridTemplateColumns: `repeat(${display.columns}, minmax(0, 1fr))` };

  return (
    <div className="@container flex flex-col gap-3" data-testid="operator-slides" data-grouped={display.grouped ? "" : undefined} data-section-colors={display.sectionColor} data-tiles={display.tiles}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" disabled={!canPresent || here === null || here <= 0} onClick={() => here !== null && send(here - 1)} aria-label={t("screens.previousSlide")}>
          <ChevronLeft />
        </Button>
        <Button size="icon" variant="outline" disabled={!canPresent || (here !== null && here >= slides.length - 1)} onClick={() => send(here === null ? 0 : here + 1)} aria-label={t("screens.nextSlide")} data-testid="operator-next">
          <ChevronRight />
        </Button>
        <Button
          size="sm"
          variant={presenting?.black ? "default" : "outline"}
          disabled={!canPresent || !presenting}
          aria-pressed={!!presenting?.black}
          onClick={() => presenting && presentScreens({ ...presenting, black: !presenting.black })}
          data-testid="operator-black"
        >
          <MonitorOff />
          {t("screens.blackButton")}
        </Button>
        <Button size="sm" variant="ghost" disabled={!canPresent || !presenting} onClick={() => presentScreens(null)} data-testid="operator-stop">
          <Square />
          {t("screens.stopPresenting")}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="accent-primary" checked={notesShown} onChange={(e) => setNotesShown(e.target.checked)} data-testid="operator-notes" />
            {t("screens.operator.showNotes")}
          </label>
          {notesShown && positions.length > 0 ? (
            <NativeSelect value={position} onChange={(e) => setPosition(e.target.value)} aria-label={t("screens.operator.notesOf")} data-testid="operator-notes-position" compact>
              <option value="">{t("screens.operator.allNotes")}</option>
              {positions.map((one) => (
                <option key={one.id} value={one.id}>
                  {t("screens.operator.notesByPosition", { position: one.name })}
                </option>
              ))}
            </NativeSelect>
          ) : null}
        </div>
      </div>
      {!canPresent && session?.screens?.exclusive ? (
        <p className="text-xs text-muted-foreground" data-testid="operator-locked">
          {t(session.screens.online === false ? "screens.operator.lockedByOffline" : "screens.operator.lockedBy", { name: session.screens.name })}
        </p>
      ) : null}
      {sections.length > 1 ? (
        <nav className="flex flex-wrap gap-1.5" aria-label={t("screens.operator.sections")} data-testid="operator-sections">
          {sections.map((section, index) => {
            const on = here !== null && here >= section.slide && (sections[index + 1] === undefined || here < sections[index + 1]!.slide);
            return (
              <button
                key={section.slide}
                type="button"
                disabled={!canPresent}
                onClick={() => send(section.slide)}
                data-section-color={section.type}
                className={cn("flex items-center gap-1.5 rounded-md border bg-[var(--section-tint)] px-2 py-1 text-xs font-medium enabled:hover:border-[var(--section-line)] disabled:cursor-not-allowed", on ? "border-primary ring-2 ring-primary/30" : "border-[var(--section-line)]/40")}
                aria-current={on ? "true" : undefined}
                data-testid="operator-section"
              >
                {index < 9 ? <Kbd className="h-4 min-w-4 px-1 text-[10px]">{index + 1}</Kbd> : null}
                {section.label}
              </button>
            );
          })}
        </nav>
      ) : null}
      {songNotes.length > 0 ? <NotesList notes={songNotes} /> : null}
      {groups.map((group) => {
        const pass = chart?.passes[group.passIndex];
        const name = pass ? passName(pass, pass.section, pass.section.number, (type) => t(`chart.sections.${type}`)) : null;
        const tiles = (
          <ul className={cn("grid gap-3", display.columns === "auto" && "grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-4")} style={gridStyle}>
            {slides.slice(group.from, group.to).map((slide, offset) => {
              const index = group.from + offset;
              const tilePass = chart?.passes[slide.passIndex];
              const first = index === 0 || slides[index - 1]!.passIndex !== slide.passIndex;
              const passNotes = first ? notesFor(slide.passIndex) : [];
              return (
                <li key={index} className="flex flex-col gap-1">
                  <SlideTile slide={slide} index={index} pass={tilePass ?? null} tag={first && !display.grouped} on={here === index} black={here === index && !!presenting?.black} disabled={!canPresent} onSend={() => send(index)} />
                  {passNotes.length > 0 ? <NotesList notes={passNotes} /> : null}
                </li>
              );
            })}
          </ul>
        );
        if (!display.grouped) return <div key={group.from}>{tiles}</div>;
        return (
          <section key={group.from} className="flex flex-col gap-1.5" data-testid="operator-slide-group" data-section-color={pass?.section.type}>
            <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
              <span className={cn("rounded px-1.5 py-0.5", display.sectionColor === "none" ? "bg-muted text-muted-foreground" : "bg-[var(--section-tag)] text-[var(--section-ink)]")}>{name ?? t("screens.operator.slides")}</span>
              <span className="font-normal text-muted-foreground normal-case tabular-nums">{t("screens.operator.slideCount", { count: group.to - group.from })}</span>
            </h3>
            {tiles}
          </section>
        );
      })}
    </div>
  );
}

/** A slide as a tile, drawn as the Display options say; pressed, it goes on the screens. */
function SlideTile({ slide, index, pass, tag, on, black, disabled, onSend }: { slide: ScreenSlide; index: number; pass: RenderedChart["passes"][number] | null; tag: boolean; on: boolean; black: boolean; disabled: boolean; onSend: () => void }) {
  const { t } = useTranslation();
  const display = useOperatorDisplay();
  const dark = display.tiles === "dark";
  const color = display.sectionColor;
  const name = pass ? passName(pass, pass.section, pass.section.number, (type) => t(`chart.sections.${type}`)) : null;
  const header = color === "header" && pass;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSend}
      data-section-color={pass?.section.type}
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg border-2 text-left disabled:cursor-not-allowed",
        TILE_HEIGHT[display.size],
        dark ? "bg-neutral-950 text-neutral-100" : color === "tile" ? "bg-[var(--section-tint)]" : "bg-card",
        on ? "border-primary ring-2 ring-primary/30" : color === "none" ? "border-border enabled:hover:border-foreground/30" : "border-[var(--section-line)]/40 enabled:hover:border-[var(--section-line)]",
        dark && color === "tile" && !on && "border-[var(--section-line)]",
        black && "opacity-60",
      )}
      aria-current={on ? "true" : undefined}
      data-testid="operator-slide"
      data-slide={index}
    >
      {header ? (
        <span className="flex items-center gap-1 bg-[var(--section-tag)] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--section-ink)] uppercase" data-testid="operator-slide-header">
          <span className="truncate">{name}</span>
          {display.numbers ? <span className="ml-auto font-normal tabular-nums">{index + 1}</span> : null}
        </span>
      ) : tag || display.numbers ? (
        <span className="flex items-center gap-1 px-2 pt-1.5">
          {tag && pass ? (
            <span className={cn("rounded px-1.5 text-[10px] font-semibold tracking-wide uppercase", color === "none" ? "bg-muted text-muted-foreground" : "bg-[var(--section-tag)] text-[var(--section-ink)]")}>{name}</span>
          ) : null}
          {display.numbers ? <span className={cn("ml-auto text-[10px] tabular-nums", dark ? "text-neutral-400" : "text-muted-foreground")}>{index + 1}</span> : null}
        </span>
      ) : null}
      <span className={cn("flex flex-1 flex-col gap-0.5 px-2 pt-1 pb-2", TEXT_SIZE[display.size], display.uppercase && "uppercase")} style={{ fontFamily: FONT_FAMILY[display.font] }}>
        {slide.lines.length ? (
          slide.lines.map((line, i) => (
            <span key={i} className="leading-snug">
              {line}
            </span>
          ))
        ) : (
          <span className={cn("italic normal-case", dark ? "text-neutral-400" : "text-muted-foreground")}>{t("screens.noWords")}</span>
        )}
      </span>
    </button>
  );
}

function NotesList({ notes }: { notes: SongNote[] }) {
  return (
    <ul className="flex flex-col gap-1" data-testid="operator-note-list">
      {notes.map((note) => (
        <li key={note.id} className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs" data-testid="operator-note">
          <span className="font-semibold">{note.author.displayName}: </span>
          {note.content}
        </li>
      ))}
    </ul>
  );
}

/**
 * The console's Display options (issue #358), kept on this device: how the
 * slides look, how many to a row, and how the screens are shown.
 */
export function DisplayMenu() {
  const { t } = useTranslation();
  const display = useOperatorDisplay();
  const choice = <K extends keyof OperatorDisplay>(key: K, values: readonly OperatorDisplay[K][], label: string) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <NativeSelect compact value={String(display[key])} onChange={(event) => changeOperatorDisplay({ [key]: event.target.value } as Partial<OperatorDisplay>)} data-testid={`operator-display-${key}`}>
        {values.map((value) => (
          <option key={String(value)} value={String(value)}>
            {t(`screens.operator.display.${key}Options.${String(value)}`)}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
  const check = (key: "uppercase" | "grouped" | "numbers", label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-primary" checked={display[key]} onChange={(event) => changeOperatorDisplay({ [key]: event.target.checked })} data-testid={`operator-display-${key}`} />
      {label}
    </label>
  );
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" data-testid="operator-display" />}>
        <SlidersHorizontal />
        {t("screens.operator.display.button")}
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3" data-testid="operator-display-menu">
        <p className="text-xs text-muted-foreground">{t("screens.operator.display.hint")}</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold text-muted-foreground uppercase">{t("screens.operator.display.slides")}</legend>
          {choice("font", OPERATOR_FONTS, t("screens.operator.display.font"))}
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>{t("screens.operator.display.size")}</span>
            <div className="flex rounded-md border p-0.5" role="group" aria-label={t("screens.operator.display.size")}>
              {OPERATOR_SIZES.map((size) => (
                <Button key={size} size="sm" variant={display.size === size ? "secondary" : "ghost"} className="h-7 min-w-8 px-2 text-xs" aria-pressed={display.size === size} onClick={() => changeOperatorDisplay({ size })} data-testid={`operator-display-size-${size}`}>
                  {t(`screens.operator.display.sizeOptions.${size}`)}
                </Button>
              ))}
            </div>
          </div>
          {check("uppercase", t("screens.operator.display.uppercase"))}
          {choice("sectionColor", OPERATOR_SECTION_COLORS, t("screens.operator.display.sectionColor"))}
          {check("grouped", t("screens.operator.display.grouped"))}
          {choice("columns", OPERATOR_COLUMNS, t("screens.operator.display.columns"))}
          {check("numbers", t("screens.operator.display.numbers"))}
          {choice("tiles", OPERATOR_TILES, t("screens.operator.display.tiles"))}
        </fieldset>
        <fieldset className="flex flex-col gap-2 border-t pt-3">
          <legend className="sr-only">{t("screens.operator.screensView.title")}</legend>
          {choice("screens", OPERATOR_SCREEN_VIEWS, t("screens.operator.display.screens"))}
        </fieldset>
        <Button variant="ghost" size="sm" className="self-start" onClick={resetOperatorDisplay} data-testid="operator-display-reset">
          <RotateCcw />
          {t("screens.operator.display.reset")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
