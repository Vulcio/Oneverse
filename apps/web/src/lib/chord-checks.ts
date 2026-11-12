import { checkChartChords, type ChartChordChecks, type ChordCheck, type SectionV2 } from "@oneverse/core";
import type { TFunction } from "i18next";
import { useMemo } from "react";
import { createDeviceStore } from "#/lib/device-store";

/**
 * Chords that seem out of place (issue #356), in the song editor: worked
 * out from the chart as it's edited, minus those someone chose to keep. A
 * chord kept is remembered on the device by its ID and symbol, so changing
 * it to something else that seems out of place marks it again.
 */

const KEPT_LIMIT = 500;

const kept = createDeviceStore<string[]>("songverse.chordChecksKept", {
  fallback: [],
  parse: (raw) => {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [];
  },
  format: (value) => (value.length ? JSON.stringify(value) : null),
});

const keptKey = (check: Pick<ChordCheck, "chordId" | "raw">) => `${check.chordId}:${check.raw}`;
const keyKept = (written: string, fits: string) => `key:${written}:${fits}`;

/** Keeps a chord as written: it isn't marked again unless it changes. */
export function keepChord(check: Pick<ChordCheck, "chordId" | "raw">) {
  kept.set([...kept.get().filter((one) => one !== keptKey(check)), keptKey(check)].slice(-KEPT_LIMIT));
}

/** Keeps the song's key: the chords not fitting it aren't said again, unless they come to fit yet another key. */
export function keepKey(written: string, fits: string) {
  kept.set([...kept.get().filter((one) => one !== keyKept(written, fits)), keyKept(written, fits)].slice(-KEPT_LIMIT));
}

/** The chart's chords that seem out of place, and whether its key does, without what was kept. */
export function useChordChecks(sections: SectionV2[], songKey: string): ChartChordChecks {
  const keptNow = kept.use();
  const checks = useMemo(() => checkChartChords({ key: songKey || null, sections }), [sections, songKey]);
  return useMemo(() => {
    const keptSet = new Set(keptNow);
    const keyCheck = checks.keyCheck && !keptSet.has(keyKept(checks.keyCheck.written, checks.keyCheck.fits)) ? checks.keyCheck : null;
    // A key kept that the chords don't fit: each chord outside it is marked after all.
    const chords = checks.keyCheck && !keyCheck ? checkChartChords({ key: songKey || null, sections, ignoreKeyCheck: true }).chords : checks.chords;
    return { ...checks, keyCheck, chords: chords.filter((check) => !keptSet.has(keptKey(check))) };
  }, [checks, keptNow, sections, songKey]);
}

/** Why the chord seems out of place, in a sentence or two, and what it might be. */
export function explainChordCheck(t: TFunction, check: ChordCheck): string {
  const { reason, raw } = check;
  const parts: string[] = [];
  if (reason.kind === "outsideKey") {
    parts.push(t("chordChecks.outsideKey", { chord: raw, key: reason.key, inKey: reason.inKey.join(" "), borrowed: reason.borrowed.join(" ") }));
    parts.push(t("chordChecks.rare", { count: reason.times, chord: raw }));
  } else {
    parts.push(
      t("chordChecks.unlikeOthers", {
        section: t(`chart.sections.${reason.sectionType}`),
        count: reason.others,
        usual: reason.usual,
        chord: raw,
      }),
    );
  }
  if (check.suggestion && reason.kind === "outsideKey") parts.push(t("chordChecks.meant", { chord: check.suggestion }));
  return parts.join(" ");
}
