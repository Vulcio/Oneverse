/**
 * LRC timed lyrics (issue #438): "[00:12.34]Amazing grace", with the song's
 * details in tags ("[ti:Amazing Grace]", "[ar:John Newton]"). Read as plain
 * words in the order they're sung - a line with several times is sung at
 * each - in blocks where the singing stops (an empty timed line, or a gap
 * much longer than the others). The timings themselves aren't kept yet
 * (issues #35, #188).
 */

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const TIMED_LINE = /^\s*(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+/;
const TAG_LINE = /^\s*\[([a-z#]+)\s*:\s*(.*?)\]\s*$/i;
// Enhanced LRC's word timings: "<00:12.34>Amazing <00:13.00>grace".
const WORD_TIME = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>\s?/g;

/** The details an LRC file's tags give. */
export interface LrcDetails {
  title?: string;
  artist?: string;
  album?: string;
  /** "[au:]", the song's writer. */
  writer?: string;
  durationSeconds?: number;
}

/** Whether text is LRC: most of its lines start with a time. */
export function isLrc(text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "" && !TAG_LINE.test(line));
  if (lines.length === 0) return false;
  const timed = lines.filter((line) => TIMED_LINE.test(line)).length;
  return timed >= 2 && timed / lines.length >= 0.6;
}

const seconds = (minutes: string, secs: string, fraction: string | undefined) => Number(minutes) * 60 + Number(secs) + (fraction ? Number(`0.${fraction}`) : 0);

/** An LRC file as plain words, in blocks, and the details its tags give; null when it isn't LRC. */
export function lrcToText(text: string): { text: string; details: LrcDetails } | null {
  if (!isLrc(text)) return null;
  const details: LrcDetails = {};
  const sung: { at: number; words: string }[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const tag = TAG_LINE.exec(line);
    if (tag && !/^\d/.test(tag[1]!)) {
      const value = tag[2]!.trim();
      if (!value) continue;
      const name = tag[1]!.toLowerCase();
      if (name === "ti") details.title = value;
      else if (name === "ar") details.artist = value;
      else if (name === "al") details.album = value;
      else if (name === "au") details.writer = value;
      else if (name === "length") {
        const length = /^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(value);
        if (length) details.durationSeconds = Math.round(seconds(length[1]!, length[2]!, length[3]));
      }
      continue;
    }
    const prefix = TIMED_LINE.exec(line);
    if (!prefix) continue;
    const words = line.slice(prefix[0].length).replace(WORD_TIME, "").trim();
    for (const time of prefix[0].matchAll(TIME)) sung.push({ at: seconds(time[1]!, time[2]!, time[3]), words });
  }
  sung.sort((a, b) => a.at - b.at);

  // Where the singing stops: an empty line, or a gap well over the usual one between lines.
  const gaps = sung.slice(1).map((line, i) => line.at - sung[i]!.at).filter((gap) => gap > 0);
  const usual = gaps.length > 0 ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]! : 0;
  const out: string[] = [];
  for (const [i, line] of sung.entries()) {
    const gap = i > 0 ? line.at - sung[i - 1]!.at : 0;
    if (!line.words) {
      if (out.at(-1) !== "") out.push("");
      continue;
    }
    if (i > 0 && usual > 0 && gap >= Math.max(usual * 1.8, 4) && out.at(-1) !== "") out.push("");
    out.push(line.words);
  }
  return { text: out.join("\n").trim(), details };
}
