import { chartBars, composeBuiltInTemplate, screenLayers, slideKey, stageTimers, type ScreenSwitchableLayer, type ScreenTheme, type SetlistOfflineCopy, type SyncPresenting, type SyncStage } from "@oneverse/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StageSong } from "../components/screen-stage";
import type { StageLive } from "../components/screen-widgets";
import { passageCredit, setItemTitle, setItemView, setlistTitle } from "./set-items";

type Credits = Record<string, { writers: string[]; copyright: string | null; ccli: string | null }>;

/**
 * What a screen draws for a set (issues #194, #268, #358): its look for the
 * item presented, the item as a song on the stage, and what the template's
 * widgets read. The screen itself and the operator's console's pictures of
 * the screens both work it out here, so they show the same thing.
 */
export function useStageShowing({
  set,
  credits,
  presenting,
  stage,
  offset,
  screen,
  theme,
  itemThemes,
}: {
  set: SetlistOfflineCopy | null;
  /** The songs' credits, by song version. */
  credits?: Credits;
  presenting: SyncPresenting | null;
  stage: SyncStage | null;
  offset: number;
  /** The screen: its id (its own layers) and the layers it never shows. */
  screen: { id: string; hiddenLayers?: readonly ScreenSwitchableLayer[] | null };
  theme: ScreenTheme | null | undefined;
  itemThemes?: Record<string, ScreenTheme>;
}): { look: ScreenTheme; song: StageSong | null; live: StageLive; presented: boolean } {
  const { t, i18n } = useTranslation();
  const view = presenting && set ? set.songs.find((song) => song.item.id === presenting.itemId) : undefined;
  // A passage with a template of its own (issue #310) is shown with it; anything else, the screen's. A copy kept
  // before themes (issue #194) has none: the default look.
  const look = (view && itemThemes?.[view.item.id]) || theme || composeBuiltInTemplate("classic")!;
  const song = useMemo<StageSong | null>(() => {
    if (!view || (!view.song && !view.text && !view.passage)) return null;
    const { chart, slides: cut } = setItemView(view);
    // Not the words the presenter's slides say (the song edited since, issue #247): no words rather than another slide's.
    const slides = presenting?.slideKey && slideKey(cut) !== presenting.slideKey ? cut.map((slide) => ({ ...slide, lines: [] })) : cut;
    return { key: view.item.id, title: setItemTitle(view, t), slides, credits: view.song ? credits?.[view.song.id] : undefined, attribution: view.passage ? passageCredit(view.passage) : null, chart, bars: chart && view.song ? chartBars(chart, view.song.document) : null };
  }, [view, credits, t, presenting?.slideKey]);

  // Each item's slides, counted once per set (issue #289): the Slide count widget's set.
  const slideCounts = useMemo(() => (set?.songs ?? []).map((one) => setItemView(one).slides.length), [set]);

  // What the template's widgets read (issue #268): the song's details, the next song, when this item came on.
  const [itemStartedAt, setItemStartedAt] = useState<number | null>(null);
  useEffect(() => setItemStartedAt(presenting?.itemId ? Date.now() : null), [presenting?.itemId]);
  const hidden = screen.hiddenLayers;
  const live = useMemo<StageLive>(() => {
    const songs = set?.songs ?? [];
    const at = view ? songs.indexOf(view) : -1;
    const next = at >= 0 ? songs.slice(at + 1).find((one) => one.song) : undefined;
    return {
      details: view?.song && song ? { title: view.song.title, key: song.chart?.key ?? view.song.key, tempo: view.song.tempo } : null,
      nextSong: next?.song ? { title: next.song.title, slides: setItemView(next).slides } : null,
      // The set's items (issue #272): the one on screen and the one after, whatever they are.
      item: view && at >= 0 ? { title: setItemTitle(view, t), position: at + 1, count: songs.length } : null,
      nextItem: at >= 0 && songs[at + 1] ? { title: setItemTitle(songs[at + 1]!, t) } : null,
      itemStartedAt,
      // The media operator's (issue #269).
      operator: stage?.timer ?? null,
      timers: stageTimers(stage),
      // The operator's layers, for this screen, less those it never shows (issues #280, #287).
      layers: screenLayers(stage?.layers, presenting, { id: screen.id, hidden: hidden ?? undefined }),
      title: set ? { title: setlistTitle(set.set, t, i18n.language), subtitle: set.set.teamName ?? null } : null,
      setSlides: at >= 0 ? { counts: slideCounts, item: at } : null,
      message: stage?.message?.text ?? null,
      offset,
    };
  }, [set, view, song, itemStartedAt, stage, presenting, screen.id, hidden, offset, slideCounts, t, i18n.language]);
  return { look, song, live, presented: !!presenting && !!view };
}
