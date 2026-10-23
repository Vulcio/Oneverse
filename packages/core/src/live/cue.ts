import type { SetlistOfflineCopy } from "../api-client/index.js";
import type { ScreenSlide } from "../screens/index.js";
import { setItemSlides, slideKey } from "../screens/index.js";
import { renderChart } from "../song-document/render.js";
import type { SyncPresenting } from "../sync/index.js";

/**
 * Cue (issue #322): moving a set's screens to the next or previous song or
 * section, for someone who may cue but not present any slide they like - a
 * singer from Songverse's Live. Where it goes is worked out where the session
 * runs, from the set as every client cuts it (setItemSlides), never sent by the
 * device: the API from the set, Pulse from its copy of it.
 */

/** A set item as a cue sees it: where its sections start, by slide, and what its slides say (slideKey). */
export interface CueItem {
  id: string;
  /** The first slide of each section (a song's pass, a text's paragraph, a passage's verses as cut), from 0, ascending. */
  sections: number[];
  /** Its slides' key; left out when the words aren't known where the session runs (a screen checks nothing then). */
  slideKey?: string;
}

export type CueDirection = "next" | "previous";
export type CueTo = "item" | "section";

/** A set item as a cue sees it, from its slides as the screens cut them; none known: one section, no key. */
export function cueItem(id: string, slides: Pick<ScreenSlide, "passIndex" | "lines">[] | null): CueItem {
  if (!slides || slides.length === 0) return { id, sections: [0] };
  const sections = slides.flatMap((slide, index) => (index === 0 || slide.passIndex !== slides[index - 1]!.passIndex ? [index] : []));
  return { id, sections, slideKey: slideKey(slides) };
}

/**
 * A set's items as a cue sees them, from a copy of it (Oneverse Pulse's): a
 * song's lyrics and a text's paragraphs as the screens cut them. A passage is
 * one section with no key, as the API, which doesn't read its verses for a
 * cue, has it: a cue goes to the same place wherever the session runs.
 */
export function cueItemsOfCopy(copy: Pick<SetlistOfflineCopy, "songs">): CueItem[] {
  return [...copy.songs]
    .sort((a, b) => a.item.position - b.item.position)
    .map((view) => {
      if (view.text) return cueItem(view.item.id, setItemSlides({ text: view.text }));
      if (!view.song) return cueItem(view.item.id, null);
      return cueItem(view.item.id, setItemSlides({ chart: renderChart(view.song.document, view.arrangement?.document ?? null) }));
    });
}

/** The first slide of `items[index]`'s section `section` (-1: its last), shown. */
function at(item: CueItem, section: number): SyncPresenting {
  const start = section < 0 ? item.sections[item.sections.length - 1]! : item.sections[section]!;
  return { itemId: item.id, slide: start, black: false, ...(item.slideKey !== undefined && { slideKey: item.slideKey }) };
}

/**
 * Where a cue from `presenting` goes: the first slide of the next or previous
 * item, or of the next or previous section (past an item's last, the next
 * item's first; before its first, the previous item's last). Nothing shown,
 * or an item no longer in the set: the set's first item. Null: nowhere to
 * go (the end of the set, or an empty one).
 */
export function cueTarget(items: CueItem[], presenting: SyncPresenting | null, direction: CueDirection, to: CueTo): SyncPresenting | null {
  if (items.length === 0) return null;
  const index = presenting ? items.findIndex((item) => item.id === presenting.itemId) : -1;
  if (index < 0) return at(items[0]!, 0);
  const item = items[index]!;
  const step = direction === "next" ? 1 : -1;
  if (to === "section") {
    // The section it's in: the last start at or before its slide.
    let section = 0;
    for (let i = 0; i < item.sections.length; i++) if (item.sections[i]! <= presenting!.slide) section = i;
    // Back from inside a section: its own start first, as a "back to the verse" would.
    if (direction === "previous" && presenting!.slide > item.sections[section]!) return at(item, section);
    const other = section + step;
    if (other >= 0 && other < item.sections.length) return at(item, other);
    const neighbour = items[index + step];
    return neighbour ? at(neighbour, direction === "next" ? 0 : -1) : null;
  }
  const neighbour = items[index + step];
  return neighbour ? at(neighbour, 0) : null;
}
