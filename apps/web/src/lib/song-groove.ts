import { chartBars, grooveBar, type GrooveBar, type RenderedChart, type SongDocumentV2 } from "@oneverse/core";
import { useEffect, useMemo } from "react";
import { releaseMetronomeGroove, setMetronomeGroove, type MetronomeGroove } from "#/lib/metronome-engine";

/** Each bar's groove (issue #105): its section's, in its pass's time signature; null where none plays. */
export function songGrooves(chart: RenderedChart, document: Pick<SongDocumentV2, "sections"> | null | undefined, bars = chartBars(chart, document)): (GrooveBar | null)[] {
  const sections = new Map((document?.sections ?? []).map((section) => [section.id, section]));
  return bars.map((bar) => grooveBar(sections.get(bar.sectionId)?.groove, bar, chart.passes[bar.passIndex]?.timeSignature ?? chart.timeSignature));
}

/**
 * A song's grooves, played with the metronome started for it while its page
 * is open (issue #105): the drums keep time where its sections have one.
 */
export function useSongGroove(songId: string, chart: RenderedChart | null | undefined, document: Pick<SongDocumentV2, "sections"> | null | undefined): void {
  const groove = useMemo<MetronomeGroove | null>(() => {
    if (!chart) return null;
    const bars = chartBars(chart, document);
    const played = songGrooves(chart, document, bars);
    return played.some(Boolean) ? { songId, bars, played } : null;
  }, [songId, chart, document]);
  useEffect(() => {
    if (!groove) return;
    setMetronomeGroove(groove);
    return () => releaseMetronomeGroove(groove);
  }, [groove]);
}

/** `useSongGroove` as a part of a page, beside its beat display. */
export function SongGroove({ songId, chart, document }: { songId: string; chart: RenderedChart | null | undefined; document: Pick<SongDocumentV2, "sections"> | null | undefined }): null {
  useSongGroove(songId, chart, document);
  return null;
}
