import { barsLength, chartSeconds, formatDuration, positionAtSeconds, scrollStops, secondsAtPosition, type ChartBar, type RenderedChart, type ScrollStop, type SongDocumentV2 } from "@oneverse/core";
import { useEffect, useRef } from "react";
import { passSelector } from "@oneverse/screen/components/song-chart";

/**
 * Autoscroll (issue #414), in Live and in Practice: the page moves through a
 * song as it's played - each line in its time, as the song's bars say
 * (`barSeconds`, stretched to its duration when it has one) - keeping the
 * line due now about a third of the way down the screen. An intro or an
 * instrumental holds its place as long as it lasts; a short line goes by
 * quickly. While the song's stems, its recording or its metronome play, it
 * follows them instead of its own clock. Scrolled by hand, it carries on
 * from there.
 */

/** One song on the page, as autoscroll goes through it. */
export interface AutoscrollSong {
  /** Where its chart is: its lines are found in it by `data-pass` and `data-line-id`. Without them (a PDF), it moves through it evenly. */
  element: HTMLElement | null;
  bars: readonly ChartBar[];
  /** How long each bar lasts, in seconds (`barSeconds`). */
  seconds: readonly number[];
}

export interface AutoscrollOptions {
  /** What scrolls: an element, or the page (`document.scrollingElement`). */
  scroller: () => HTMLElement | null;
  /** The songs, top to bottom, on into the next. */
  songs: () => AutoscrollSong[];
  playing: boolean;
  speed: number;
  /** The music playing one of the songs: the song's index, and where it is, in beats from its start. Followed rather than the clock. */
  music: { song: number; position: () => number } | null;
  /** Where the line due now is kept, in pixels from the top of what's seen. */
  readingLine: (scroller: HTMLElement) => number;
  /** The last song's end reached. */
  onEnd: () => void;
}

interface Clock {
  song: number;
  /** Beats from the song's start. */
  beat: number;
}

interface Anchor {
  song: number;
  beat: number;
  /** Where on the page (in the scroller's content) it is. */
  y: number;
}

/** How long a jump (a page laid out again, the music jumping) takes to catch up, in ms. */
const EASE_MS = 200;
/** How long after a hand scroll the music isn't followed. */
const HAND_PAUSE_MS = 4000;
/** How often the lines are measured again, in ms (text size, columns, a window resized). */
const MEASURE_MS = 500;

export function useAutoscroll(options: AutoscrollOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const { playing } = options;
  useEffect(() => {
    if (!playing) return;
    const scroller = latest.current.scroller();
    if (!scroller) return;
    let anchors: Anchor[] = [];
    let measuredAt = -Infinity;
    let stops = new WeakMap<readonly ChartBar[], ScrollStop[]>();
    const stopsOf = (bars: readonly ChartBar[]) => {
      let found = stops.get(bars);
      if (!found) stops.set(bars, (found = scrollStops(bars)));
      return found;
    };
    const measure = () => {
      anchors = measureAnchors(scroller, latest.current.songs(), latest.current.readingLine(scroller), stopsOf);
    };
    measure();
    let position = scroller.scrollTop;
    let clock = clockAt(anchors, position + latest.current.readingLine(scroller));
    let handUntil = 0;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const { songs: songsOf, speed, music, readingLine, onEnd } = latest.current;
      const songs = songsOf();
      const elapsed = Math.min(now - last, 250);
      last = now;
      if (now - measuredAt > MEASURE_MS) {
        measure();
        measuredAt = now;
      }
      const line = readingLine(scroller);
      // Scrolled by hand meanwhile: carry on from there.
      if (Math.abs(scroller.scrollTop - Math.round(position)) > 2) {
        position = scroller.scrollTop;
        clock = clockAt(anchors, position + line);
        handUntil = now + HAND_PAUSE_MS;
      }
      const following = music && songs[music.song] ? music : null;
      if (following) {
        if (now >= handUntil) {
          const beat = following.position();
          if (Number.isFinite(beat)) clock = { song: following.song, beat: Math.max(0, beat) };
        }
      } else clock = advance(clock, songs, (elapsed * speed) / 1000);
      const distance = scroller.scrollHeight - scroller.clientHeight;
      const target = Math.max(0, Math.min(distance, yAt(anchors, clock) - line));
      position += (target - position) * Math.min(1, elapsed / EASE_MS);
      if (Math.abs(target - position) < 0.5) position = target;
      scroller.scrollTop = position;
      const ended = !following && clock.song >= songs.length - 1 && clock.beat >= barsLength(songs[clock.song]?.bars ?? []) && position === target;
      if (ended) onEnd();
      else frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      stops = new WeakMap();
    };
  }, [playing]);
}

/** The clock moved on by `seconds` of the song: on into the next past its end. */
function advance(clock: Clock, songs: readonly AutoscrollSong[], seconds: number): Clock {
  let { song, beat } = clock;
  let left = seconds;
  for (;;) {
    const one = songs[song];
    if (!one) return { song, beat };
    const total = one.seconds.reduce((sum, length) => sum + length, 0);
    const at = secondsAtPosition(one.bars, one.seconds, beat) + left;
    if (at < total || song >= songs.length - 1) return { song, beat: positionAtSeconds(one.bars, one.seconds, at) };
    left = at - total;
    song += 1;
    beat = 0;
  }
}

/**
 * Where each song's lines are on the page, in beats and pixels, top to
 * bottom: a line's bars at the line, bars without words at their pass, the
 * song's end at the bottom of its chart. Never higher than the one before
 * (columns), and never before the song's top is at the top of what's seen,
 * so starting at a song's top starts at its first beat.
 */
function measureAnchors(scroller: HTMLElement, songs: readonly AutoscrollSong[], line: number, stopsOf: (bars: readonly ChartBar[]) => ScrollStop[]): Anchor[] {
  const page = scroller === document.scrollingElement;
  const viewTop = page ? 0 : scroller.getBoundingClientRect().top;
  const yOf = (box: DOMRect) => box.top - viewTop + scroller.scrollTop;
  const anchors: Anchor[] = [];
  let floor = -Infinity;
  songs.forEach((song, index) => {
    const element = song.element;
    if (!element) return;
    const box = element.getBoundingClientRect();
    // The first song from the page's top; one stacked under another from its own, a little above it.
    const top = index === 0 ? 0 : yOf(box) - 8;
    floor = Math.max(floor, top + line);
    const add = (beat: number, y: number) => {
      floor = Math.max(floor, y);
      anchors.push({ song: index, beat, y: floor });
    };
    const seen = new Set<string>();
    let found = 0;
    for (const stop of stopsOf(song.bars)) {
      const pass = element.querySelector<HTMLElement>(passSelector(stop.passId));
      const firstOfPass = !seen.has(stop.passId);
      seen.add(stop.passId);
      const lineElement = stop.lineId && pass ? pass.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(stop.lineId)}"]`) : null;
      // A line not shown (a chord grid, say): its pass, for the pass's first bars.
      const target = lineElement ?? (firstOfPass || !stop.lineId ? pass : null);
      if (!target || target.getClientRects().length === 0) continue;
      add(stop.start, yOf(target.getBoundingClientRect()));
      found += 1;
    }
    if (found === 0) add(0, yOf(box));
    add(barsLength(song.bars), yOf(box) + box.height);
  });
  return anchors;
}

/** Where the page is for the clock: between the lines it's between. */
function yAt(anchors: readonly Anchor[], clock: Clock): number {
  let before: Anchor | null = null;
  for (const anchor of anchors) {
    if (anchor.song < clock.song || (anchor.song === clock.song && anchor.beat <= clock.beat)) {
      before = anchor;
      continue;
    }
    if (!before || before.song !== anchor.song || anchor.beat === before.beat) return before && before.song === clock.song ? before.y : anchor.y;
    return before.y + ((clock.beat - before.beat) / (anchor.beat - before.beat)) * (anchor.y - before.y);
  }
  return before?.y ?? 0;
}

/** The clock for a place on the page: `yAt` the other way round, the earliest beat where the page stands still. */
function clockAt(anchors: readonly Anchor[], y: number): Clock {
  const first = anchors[0];
  if (!first || y <= first.y) return { song: first?.song ?? 0, beat: 0 };
  for (let index = 0; index < anchors.length - 1; index++) {
    const from = anchors[index]!;
    const to = anchors[index + 1]!;
    if (y >= to.y && !(y === to.y && to.song === from.song && to.y === from.y)) continue;
    // Between two songs: the first one's end.
    if (to.song !== from.song) return { song: from.song, beat: from.beat };
    if (to.y === from.y) return { song: from.song, beat: from.beat };
    return { song: from.song, beat: from.beat + ((y - from.y) / (to.y - from.y)) * (to.beat - from.beat) };
  }
  const end = anchors.at(-1)!;
  return { song: end.song, beat: end.beat };
}

/**
 * How long a song lasts, for its details (issue #414): its own duration
 * ("3:40"), or the one worked out from its bars and tempo, marked as a guess
 * ("~3:40"); null when there's nothing to play.
 */
export function songLengthText(chart: RenderedChart, durationSeconds: number | null | undefined, document?: Pick<SongDocumentV2, "sections"> | null): string | null {
  if (durationSeconds && durationSeconds > 0) return formatDuration(durationSeconds);
  const seconds = chartSeconds(chart, null, document);
  return seconds > 0 ? `~${formatDuration(seconds)}` : null;
}
