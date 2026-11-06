import { barAt, sungAtPosition, type ScreenTheme } from "@oneverse/core";
import { useEffect, type RefObject } from "react";
import { songBars, songPlaces, type StageSong } from "../components/screen-text";

/** The lines being shown on a stage, in order: a slide's current lines, or the column's around the current slide. */
const CURRENT_LINES = '[data-testid="screen-lyrics"] [data-group="screen-lines"] .sv-line, .sv-flow:not([aria-hidden]) [data-now] .sv-line';

/**
 * A stage following the music (issue #395): where the music is, frame by
 * frame, marked on the words the stage already shows - the line being sung
 * (`data-sung="now"`, the lines before it "sung", after it "coming"), how
 * far through its words (each word's `--f`, for Fill), the chord sounding
 * over it and the beat being played (`data-lit`). Nothing is drawn again:
 * only attributes change, when they do. Without the music, nothing's marked.
 */
export function useFollowMusic(stage: RefObject<HTMLElement | null>, song: StageSong | null, theme: ScreenTheme, position: (() => number) | null | undefined): void {
  const follow = theme.display.follow;
  const lightChords = theme.chords.current && (theme.chords.show !== "off" || theme.display.mode === "grid");
  useEffect(() => {
    const root = stage.current;
    const chart = song?.chart;
    if (!root || !song || !chart || !position || (follow === "off" && !lightChords)) return;
    const bars = songBars(song);
    const places = songPlaces(song);
    if (bars.length === 0) return;
    if (follow !== "off") root.dataset.follow = follow;
    const marked = new Set<HTMLElement>();
    const mark = (element: HTMLElement, name: string, value: string) => {
      if (element.dataset[name] !== value) element.dataset[name] = value;
      marked.add(element);
    };
    let frame = requestAnimationFrame(function tick() {
      const at = position();
      const sung = follow !== "off" ? sungAtPosition(chart, bars, places, at) : null;
      const where = barAt(bars, at);
      const keep = new Set<HTMLElement>();
      const lines = [...root.querySelectorAll<HTMLElement>(CURRENT_LINES)];
      const now = sung ? lines.findIndex((line) => line.dataset.lineId === sung.lineId && line.dataset.pass === String(sung.passIndex)) : -1;
      if (now >= 0 && sung) {
        lines.forEach((line, index) => {
          mark(line, "sung", index < now ? "sung" : index === now ? "now" : "coming");
          keep.add(line);
        });
        if (follow === "fill")
          lines[now]!.querySelectorAll<HTMLElement>("[data-from]").forEach((word) => {
            const from = Number(word.dataset.from);
            const to = Number(word.dataset.to);
            const filled = `${Math.round(Math.max(0, Math.min(1, (sung.at - from) / Math.max(1, to - from))) * 104)}%`;
            if (word.style.getPropertyValue("--f") !== filled) word.style.setProperty("--f", filled);
          });
      }
      if (lightChords && where) {
        // The chord sounding, over the line being sung (else the slide's), and the beat.
        const chord = where.chord;
        const scope = now >= 0 ? [lines[now]!] : lines;
        if (chord)
          for (const line of scope)
            line.querySelectorAll<HTMLElement>(`[data-chord-id="${CSS.escape(chord.id)}"] .sv-chord-name`).forEach((name) => {
              mark(name, "lit", "");
              keep.add(name);
            });
        root.querySelectorAll<HTMLElement>(`[data-bar="${where.bar}"] [data-beat="${where.beat}"]`).forEach((beat) => {
          mark(beat, "lit", "");
          keep.add(beat);
        });
      }
      // What was marked and isn't any more.
      for (const element of marked)
        if (!keep.has(element)) {
          delete element.dataset.sung;
          delete element.dataset.lit;
          marked.delete(element);
        }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      for (const element of marked) {
        delete element.dataset.sung;
        delete element.dataset.lit;
      }
      delete root.dataset.follow;
    };
  }, [stage, song, position, follow, lightChords]);
}
