import { renderChart, setItemSlides, type RenderedChart, type ScreenSlide, type SetlistSongView, type SetlistSummary } from "@oneverse/core";
import type { TFunction } from "i18next";
import { formatSetDate, formatSetDay } from "@oneverse/ui/lib/dates";

/**
 * A set's custom name, else its date written out, else "Untitled set". A
 * set made for a date of its team's calendar (issue #235) is its name and
 * that date, in the reader's language: "Morning service - 12 Oct".
 */
export function setlistTitle(set: Pick<SetlistSummary, "name" | "eventDate" | "fromEvent">, t: TFunction, locale: string): string {
  if (set.name && set.fromEvent && set.eventDate) return `${set.name} - ${formatSetDay(set.eventDate, locale)}`;
  if (set.name) return set.name;
  if (set.eventDate) return formatSetDate(set.eventDate, locale, "long");
  return t("sets.untitled");
}

/** A set item's title (issue #305): a song's, a text's (else "Text"), or the placeholder for a song the viewer can't read. */
export function setItemTitle(item: { text?: { title: string } | null; song: { title: string } | null }, t: TFunction): string {
  if (item.text) return item.text.title || t("sets.text.untitled");
  return item.song?.title ?? t("sets.hiddenSong");
}

/**
 * A set item as the screens cut it (issue #305): a song's chart, as played in
 * the set, and its lyrics' slides, or a text's paragraphs with no chart.
 */
export function setItemView(view: Pick<SetlistSongView, "item" | "song" | "arrangement" | "text">): { chart: RenderedChart | null; slides: ScreenSlide[] } {
  const chart = view.song ? renderChart(view.song.document, view.arrangement?.document ?? null, { transposeSteps: view.item.transposeSteps, suggestedCapo: view.song.suggestedCapo }) : null;
  return { chart, slides: setItemSlides({ chart, text: view.text }) };
}
