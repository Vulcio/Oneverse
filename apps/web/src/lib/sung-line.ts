import { barAt, barBeatPlaces, chartBars, lineAtPosition, type RenderedChart, type SongDocumentV2 } from "@oneverse/core";
import { useEffect, useMemo, type RefObject } from "react";
import { useBarsClock } from "#/lib/bars-clock";
import { keepInView } from "#/lib/follow-view";
import { passSelector } from "@oneverse/screen/components/song-chart";

/** Lit a beat before it's sung, so it's read in time. */
const AHEAD = 1;

/**
 * The chart following the music (issue #365): while this song's stems or
 * click play, the line being sung - as the beats are placed in the words
 * (`lineAtPosition`) - is marked `data-sung` and kept in view, or its
 * section's heading before its first words. Who records a part reads along
 * behind the recorder; the chord grid does the same for its bars.
 */
export function useSungLine(container: RefObject<HTMLElement | null>, songId: string, chart: RenderedChart, document: Pick<SongDocumentV2, "sections"> | null | undefined): void {
  const bars = useMemo(() => chartBars(chart, document), [chart, document]);
  const places = useMemo(() => barBeatPlaces(chart, bars), [chart, bars]);
  const { position } = useBarsClock(songId, bars);
  useEffect(() => {
    const root = container.current;
    if (!root || !position || bars.length === 0) return;
    let lit: HTMLElement | null = null;
    let shown: string | null = null;
    let frame = requestAnimationFrame(function tick() {
      const at = position() + AHEAD;
      const line = lineAtPosition(bars, places, at);
      const where = barAt(bars, at);
      const passIndex = line?.passIndex ?? (where ? bars[where.bar]!.passIndex : null);
      const key = line ? `${line.passIndex}:${line.lineId}` : passIndex === null ? "" : `${passIndex}`;
      if (key !== shown) {
        shown = key;
        if (lit) delete lit.dataset.sung;
        lit = null;
        const passId = passIndex === null ? undefined : chart.passes[passIndex]?.id;
        const pass = passId ? root.querySelector<HTMLElement>(passSelector(passId)) : null;
        if (pass && line) lit = pass.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(line.lineId)}"]`);
        if (lit) lit.dataset.sung = "";
        root.dataset.sung = key;
        const target = lit ?? pass?.querySelector<HTMLElement>("[data-pass-heading]") ?? pass;
        if (target) keepInView(target);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (lit) delete lit.dataset.sung;
      delete root.dataset.sung;
    };
  }, [container, position, bars, places, chart]);
}
