import type { SectionType } from "../constants/index.js";

// Section names as songs from other tools write them, in the languages
// songs come in, each with the section type it means.
const SECTION_NAMES: [SectionType, string][] = [
  ["pre-chorus", "pre[- ]?chorus|pr[ée][- ]?refrain|pre[- ]?coro|pr[ée][- ]?refr[ãa]o|pre[- ]?ritornello"],
  ["post-chorus", "post[- ]?chorus|post[- ]?refrain|post[- ]?coro"],
  ["chorus", "chorus|refrain|coro|estribillo|refr[ãa]o|ritornello"],
  ["verse", "verse|strophe|couplet|estrofa|verso|strofa|vers"],
  ["bridge", "bridge|pont|puente|ponte|br[üu]cke"],
  ["intro", "intro|introduction|introducci[óo]n|introdu[çc][ãa]o|introduzione|vorspiel"],
  ["outro", "outro|ending|fin|final|finale|coda|nachspiel"],
  ["instrumental", "instrumental|solo"],
  ["interlude", "interlude|interludio|zwischenspiel"],
  ["vamp", "vamp"],
  ["breakdown", "breakdown"],
  ["tag", "tag"],
  ["other", "other"],
];
const NAMES = SECTION_NAMES.map(([, names]) => names).join("|");

// A line containing only a section name, optionally numbered or lettered,
// bracketed, or followed by a colon ("Verse 1", "[Chorus]", "Bridge:",
// "Strophe 2a", "Fin b") is a label for the block that follows. Shared
// between the ChordPro and chords-over-lyrics parsers, which both accept
// this as the common convention for text pasted from other tools rather
// than authored with explicit directives; a ChordPro comment holding one
// names the section after it.
export const LABEL_LINE = new RegExp(`^\\[?\\s*(${NAMES})(?:\\s*\\.?\\s*(\\d+[a-d]?)|\\s*\\.?\\s*([a-d]))?\\s*:?\\s*\\]?$`, "iu");

export function normalizeSectionType(label: string): SectionType {
  const name = label.trim();
  return SECTION_NAMES.find(([, names]) => new RegExp(`^(?:${names})$`, "iu").test(name))?.[0] ?? "other";
}

/** A section heading ("Strophe 2", "Refrain", "[Bridge]"): its type and its number or letter, if it has one; null if the text isn't one. */
export function sectionHeading(text: string): { type: SectionType; number: string | null } | null {
  const match = LABEL_LINE.exec(text.trim());
  if (!match) return null;
  return { type: normalizeSectionType(match[1]!), number: match[2] ?? match[3] ?? null };
}

const NUMBER = "\\s*\\.?\\s*(\\d+[a-d]?|[a-d])(?![x×\\d])";

// A heading with the section's first words or chords after it on the same
// line: "Verse 1: Amazing grace", "[Intro] G D Em C", "Chorus : [C]My chains".
const HEADING_WITH_CONTENT = new RegExp(`^(\\[\\s*(?:${NAMES})(?:${NUMBER})?\\s*\\]|(?:${NAMES})(?:${NUMBER})?\\s*:)\\s*(\\S.*)$`, "iu");

/** A line that starts with a heading and goes on with words or chords: the two parts; null otherwise. */
export function headingWithContent(text: string): { heading: string; rest: string } | null {
  const match = HEADING_WITH_CONTENT.exec(text.trim());
  if (!match) return null;
  return { heading: match[1]!.replace(/\s*:$/, ""), rest: match[match.length - 1]! };
}

// "Repeat chorus", "Chorus x2", "(Chorus 2x)", "Refrain (bis)", "Back to the bridge", "Reprendre le refrain".
const REPEAT_WORDS = "repeat|rpt\\.?|back\\s+to|go\\s+to|again|reprise(?:\\s+(?:du|de\\s+la|de\\s+l'))?|reprendre|r[ée]p[ée]ter|au|al|zum|wiederhole|repetir|repita|ripeti(?:re)?";
const ARTICLES = "(?:the|le|la|l'|el|o|a|den|die|der|das|il)\\s*";
const TIMES = "(?:[x×]\\s*(\\d{1,2})|(\\d{1,2})\\s*[x×]|\\(\\s*[x×]?\\s*(\\d{1,2})\\s*[x×]?\\s*\\)|\\(?\\s*(bis)\\s*\\)?|(twice)|(\\d{1,2})\\s+(?:times|fois|veces|vezes|mal))";
const REPEAT_CALL = new RegExp(`^(?:(${REPEAT_WORDS})\\s+)?(?:${ARTICLES})?(${NAMES})(?:${NUMBER})?\\s*:?\\s*(?:${TIMES})?\\s*:?$`, "iu");

/** A section sung again, called by name: which one, and how many times. */
export interface RepeatCall {
  type: SectionType;
  /** "Verse 2": the second of that type; null for the last one sung. */
  number: string | null;
  times: number;
}

/**
 * A line that only says to sing a section again - "Repeat chorus", "Chorus
 * x2", "(Chorus 2x)", "Refrain (bis)", "Reprendre le refrain" - read; null
 * for anything else, a heading alone ("Chorus") included.
 */
export function repeatCall(text: string): RepeatCall | null {
  let inner = text.trim();
  // In brackets or stars: "(Repeat chorus)", "[Chorus x2]", "*Chorus x2*".
  for (const [open, close] of [["(", ")"], ["[", "]"], ["*", "*"], ["<", ">"]] as const) {
    if (inner.startsWith(open) && inner.endsWith(close) && inner.length > 2) inner = inner.slice(1, -1).trim();
  }
  const match = REPEAT_CALL.exec(inner);
  if (!match) return null;
  const [, word, name, number, ...counts] = match;
  const count = counts.find((value) => value !== undefined);
  if (!word && count === undefined) return null;
  const times = count === undefined || /^(bis|twice)$/i.test(count) ? (count ? 2 : 1) : Number(count);
  return { type: normalizeSectionType(name!), number: number ?? null, times: Math.min(Math.max(times, 1), 8) };
}
