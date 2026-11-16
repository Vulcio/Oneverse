import { screenShowsChart, type ScreenDisplayMode, type ScreenTheme } from "@oneverse/core";

/**
 * Which of a template's settings the screen reads, given its other choices:
 * the editors hide the rest, so nothing shown is without effect. Hiding never
 * changes the theme - a value hidden is kept, and is back as it was when the
 * choice that hid it is undone.
 *
 * Only what the stage provably ignores is hidden (packages/screen): Scroll
 * and Charts lay the words out on their own (no position, no line-by-line
 * reveal, no corner tag), Scroll has no slides to change, Focus shows the
 * next line rather than the lines around, a picture or video covers the
 * colours, and so on.
 */
export function settingsShown(theme: ScreenTheme, media: { picked: boolean } = { picked: false }) {
  const mode: ScreenDisplayMode = screenShowsChart(theme) ? "chart" : theme.display.mode;
  const scroll = mode === "scroll";
  const chart = mode === "chart";
  const background = theme.background.kind;
  const covered = (background === "image" || background === "video") && media.picked;
  return {
    mode,
    /** Top, middle, bottom, lower third: the slides' words only (Scroll and Charts fill the screen). */
    position: !scroll && !chart,
    /** How one slide gives way to the next: Scroll glides instead. */
    transition: !scroll,
    /** Its pace: also the length of Scroll's glide. */
    pace: scroll || theme.motion.transition !== "cut",
    /** Words coming in one by one: a slide's lines only. */
    reveal: !scroll && !chart,
    /** The lines around the slide's: Focus shows the next one, Scroll and Charts the whole song or section. */
    lines: !scroll && !chart && mode !== "focus",
    /** How those lines look: only when there are some. */
    contextStyle: theme.lines.group === "section" || theme.lines.before > 0 || theme.lines.after > 0,
    /** A section's corner tag: drawn on slides (Scroll has its own labels, Charts its headings). */
    sectionLabel: !scroll && !chart,
    /** A section's own transitions: Scroll has none. */
    sectionTransitions: !scroll,
    /** Off, above, on beats: Grid always puts them on its beats. */
    chordShow: mode !== "grid",
    /** The background's colours: under a picture or video only while it has none. */
    backgroundColors: !covered,
    /** Movement: what moves (a picture drifts, a video plays at its own pace). */
    backgroundMovement: background !== "color" && background !== "gradient" && background !== "video",
    /** Elements answering the music: only backgrounds that have some. */
    reactsElements: background !== "color" && background !== "gradient" && background !== "image" && background !== "video",
  };
}
