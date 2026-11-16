/**
 * YouVersion's Platform API (issue #304, developers.youversion.com/api):
 * the versions an App Key is licensed for, and a passage's text. Written
 * against the documentation before a key existed; the e2e suites stand in
 * for it (YOUVERSION_API_URL).
 */
import { usfmChapterParts, usfmPassageId, type BibleReference } from "@oneverse/core";
import { PROVIDER_TIMEOUT_MS } from "../metadata/provider-timeout.js";

/** Where the API is; pointed elsewhere only by the e2e suites. */
const apiBase = () => (process.env.YOUVERSION_API_URL ?? "https://api.youversion.com").replace(/\/$/, "");

/** How many chapters one passage may touch, one request each. */
export const MAX_YOUVERSION_REQUESTS = 60;

export type Fetcher = typeof fetch;

export class YouVersionApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A version as YouVersion describes it (`GET /v1/bibles/{id}`); fields it may leave out are optional. */
export interface YouVersionBibleJson {
  id: number;
  abbreviation: string;
  title?: string | null;
  localized_title?: string | null;
  localized_abbreviation?: string | null;
  language_tag: string;
  copyright?: string | null;
  info?: string | null;
  promotional_content?: string | null;
  publisher_url?: string | null;
  youversion_deep_link?: string | null;
  books?: string[];
}

interface PassageJson {
  id: string;
  content: string;
  reference: string;
}

/** A version, as Oneverse lists it. */
export interface YouVersionBible {
  id: number;
  abbreviation: string;
  title: string;
  languageTag: string;
  /** The publisher's copyright line (the short one, else the long one). */
  copyright: string | null;
  /**
   * What's shown with every passage: the copyright line, else (a version
   * whose publisher gives none, like the public-domain Martin 1744) its
   * title and what it says about itself.
   */
  attribution: string;
  /** More about the text, YouVersion's reader shows it below a chapter. */
  info: string | null;
  /** The version on YouVersion (bible.com). */
  link: string | null;
}

/** A version with the books it has (USFM ids), to check a reference without asking for its text (issue #485). */
export interface YouVersionBibleBooks extends YouVersionBible {
  books: string[] | null;
}

/** One piece of a passage as YouVersion gives it: a verse ("JHN.3.16") or a whole chapter ("JHN.3"). */
export interface YouVersionPassagePart {
  id: string;
  reference: string;
  text: string;
}

/** A publisher's text as plain text: YouVersion's attribution is shown as text, never as HTML. */
function plainText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|quot|lt|gt|apos|nbsp|#\d+);/g, (entity, code: string) =>
      code.startsWith("#") ? String.fromCodePoint(Number(code.slice(1))) : ({ amp: "&", quot: '"', lt: "<", gt: ">", apos: "'", nbsp: "\u00a0" }[code] ?? entity),
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function youVersionBible(json: YouVersionBibleJson): YouVersionBible {
  return withoutBooks(youVersionBibleBooks(json));
}

/** A version as clients see it: its list of books left out. */
export function withoutBooks(version: YouVersionBibleBooks): YouVersionBible {
  const bible: Partial<YouVersionBibleBooks> = { ...version };
  delete bible.books;
  return bible as YouVersionBible;
}

export function youVersionBibleBooks(json: YouVersionBibleJson): YouVersionBibleBooks {
  const title = json.localized_title || json.title || json.abbreviation;
  // As YouVersion's own example does: the short copyright, else the longer
  // one (`promotional_content`), which some versions have alone.
  const copyright = plainText(json.copyright) || plainText(json.promotional_content) || null;
  const info = plainText(json.info) || null;
  return {
    id: json.id,
    abbreviation: json.localized_abbreviation || json.abbreviation,
    title,
    languageTag: json.language_tag,
    copyright,
    // YouVersion's SDK refuses a version with neither, but a text out of
    // copyright needs no line: its title and info say which text it is.
    attribution: copyright ?? (info ? `${title}. ${info}` : title),
    info,
    link: json.youversion_deep_link || null,
    books: Array.isArray(json.books) ? json.books : null,
  };
}

/** A request with the key; YouVersion's errors told apart (developers.youversion.com/error-codes). */
async function get<T>(path: string, appKey: string, fetcher: Fetcher): Promise<T> {
  const res = await fetcher(`${apiBase()}${path}`, {
    headers: { "X-YVP-App-Key": appKey, Accept: "application/json" },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (res.ok) return (await res.json()) as T;
  const text = await res.text().catch(() => "");
  let said: string | undefined;
  try {
    const body = JSON.parse(text) as { message?: string; fault?: { faultstring?: string } };
    said = body.message ?? body.fault?.faultstring;
  } catch {
    // 429 answers in plain text, a path it doesn't know with nothing.
  }
  switch (res.status) {
    case 401:
      throw new YouVersionApiError(401, `YouVersion refused the App Key${said ? `: ${said}` : ""}`);
    case 403:
      throw new YouVersionApiError(403, `This App Key isn't licensed for that${said ? `: ${said}` : ""}`);
    case 404:
      throw new YouVersionApiError(404, said ? `YouVersion has no such passage or version: ${said}` : "YouVersion has no such passage or version");
    case 412:
      throw new YouVersionApiError(412, "YouVersion says the app behind this App Key is archived or removed");
    case 429:
      throw new YouVersionApiError(429, "YouVersion's request allowance for this App Key is used up - try again later");
    default:
      throw new YouVersionApiError(res.status, `YouVersion answered ${res.status}${said ? `: ${said}` : ""}`);
  }
}

/** The versions the key is licensed for in `language` (a BCP 47 tag), a page of 99 at most. */
export async function youVersionBibles(language: string, appKey: string, fetcher: Fetcher = fetch): Promise<YouVersionBible[]> {
  const params = new URLSearchParams({ "language_ranges[]": language, page_size: "99" });
  const body = await get<{ data?: YouVersionBibleJson[] }>(`/v1/bibles?${params}`, appKey, fetcher);
  return (body.data ?? []).map(youVersionBible);
}

export async function youVersionBibleById(id: number, appKey: string, fetcher: Fetcher = fetch): Promise<YouVersionBibleBooks> {
  return youVersionBibleBooks(await get<YouVersionBibleJson>(`/v1/bibles/${id}`, appKey, fetcher));
}

/**
 * What to ask YouVersion for one chapter of a passage: a passage id - a
 * verse, verses of one chapter ("JHN.3.16-18", one request however many) or
 * the whole chapter - and which of its verses to keep (null: all).
 */
export interface YouVersionAsk {
  id: string;
  from: number | null;
  to: number | null;
}

/** A reference's requests, one per chapter it touches; the same one asked twice is asked once. */
export function youVersionAsks(reference: BibleReference): YouVersionAsk[] {
  const parts = usfmChapterParts(reference);
  if (!parts) throw new YouVersionApiError(400, "A passage is a chapter or verses of one book, not a whole book");
  const asks: YouVersionAsk[] = [];
  for (const part of parts) {
    const chapter = usfmPassageId(part.book, part.chapter);
    let ask: YouVersionAsk;
    if (part.from === null && part.to === null) ask = { id: chapter, from: null, to: null };
    else if (part.from !== null && part.from === part.to) ask = { id: usfmPassageId(part.book, part.chapter, part.from), from: null, to: null };
    // Verses of one chapter are one passage id (developers.youversion.com/api: "a verse range within one chapter").
    else if (part.from !== null && part.to !== null) ask = { id: `${chapter}.${Math.min(part.from, part.to)}-${Math.max(part.from, part.to)}`, from: null, to: null };
    // To the chapter's end (or from its start): the chapter, its other verses left out - no verse list to ask first.
    else ask = { id: chapter, from: part.from, to: part.to };
    if (!asks.some((one) => one.id === ask.id && one.from === ask.from && one.to === ask.to)) asks.push(ask);
  }
  if (new Set(asks.map((one) => one.id)).size > MAX_YOUVERSION_REQUESTS) throw new YouVersionApiError(400, `A passage from YouVersion is ${MAX_YOUVERSION_REQUESTS} chapters at most`);
  return asks;
}

/** Elements whose words aren't the verses': headings, verse labels, notes and cross references (YouVersion's HTML, USFM's classes). */
const LEFT_OUT = /^(yv-vlbl|yv-n|yv-h|vp|va|f|x|s\d?|ms\d?|mr|sr|r|sp|qa|d|cl|rem|label|heading|note)$/;
const VOID = new Set(["br", "hr", "img", "wbr", "input", "meta", "link"]);

function attribute(attributes: string, name: string): string | null {
  const found = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attributes);
  return found ? (found[2] ?? found[3] ?? found[4] ?? "") : null;
}

/**
 * A passage's HTML (format=html) as its verses: each verse starts at its
 * marker (`<span class="yv-v" v="16">`, empty or wrapping the verse), its
 * label, notes and headings left out, as plain text. None when it has no
 * markers.
 */
export function youVersionHtmlVerses(html: string): { verse: string; text: string }[] {
  const verses: { verse: string; text: string }[] = [];
  const stack: { tag: string; skip: boolean }[] = [];
  let skipping = 0;
  const say = (text: string) => {
    if (skipping > 0 || verses.length === 0) return;
    verses[verses.length - 1]!.text += text;
  };
  for (const token of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|<!--[\s\S]*?-->|([^<]+)/g)) {
    const [, closing, rawTag, attributes = "", selfClosing, text] = token;
    if (text !== undefined) {
      say(plainEntities(text));
      continue;
    }
    if (!rawTag) continue;
    const tag = rawTag.toLowerCase();
    if (closing) {
      // Back to the element it closes (a stray closing tag closes nothing).
      const at = stack.map((one) => one.tag).lastIndexOf(tag);
      if (at < 0) continue;
      for (const one of stack.splice(at)) if (one.skip) skipping--;
      if (tag === "p" || tag === "div") say(" ");
      continue;
    }
    if (tag === "br") say(" ");
    const classes = (attribute(attributes, "class") ?? "").split(/\s+/).filter(Boolean);
    const number = classes.includes("yv-v") ? attribute(attributes, "v") : null;
    if (number && skipping === 0 && /^\d+(-\d+)?$/.test(number)) {
      // A verse printed twice (a marker and a wrapper) is one verse.
      if (verses[verses.length - 1]?.verse !== number) verses.push({ verse: number, text: "" });
    }
    if (selfClosing || VOID.has(tag)) continue;
    const skip = classes.some((one) => LEFT_OUT.test(one));
    stack.push({ tag, skip });
    if (skip) skipping++;
  }
  return verses.map((one) => ({ verse: one.verse, text: one.text.replace(/\s+/g, " ").trim() })).filter((one) => one.text);
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', lt: "<", gt: ">", apos: "'", nbsp: " ", lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", laquo: "\u00ab", raquo: "\u00bb" };

function plainEntities(text: string): string {
  return text.replace(/&([a-z]+|#\d+|#x[0-9a-fA-F]+);/g, (entity, code: string) =>
    code.startsWith("#x") ? String.fromCodePoint(Number.parseInt(code.slice(2), 16)) : code.startsWith("#") ? String.fromCodePoint(Number(code.slice(1))) : (ENTITIES[code] ?? entity),
  );
}

/**
 * One request's text, verse by verse ("JHN.3.16" each): asked as HTML,
 * which marks where each verse starts - plain text doesn't. A piece without
 * markers is one part, under the id it was asked by.
 */
export async function youVersionPiece(bibleId: number, id: string, appKey: string, fetcher: Fetcher = fetch): Promise<YouVersionPassagePart[]> {
  const piece = await get<PassageJson>(`/v1/bibles/${bibleId}/passages/${encodeURIComponent(id)}?format=html&include_headings=false&include_notes=false`, appKey, fetcher);
  const [book, chapter] = id.split(".");
  const verses = youVersionHtmlVerses(piece.content ?? "");
  if (verses.length === 0) {
    const text = (piece.content ?? "").replace(/<[^>]*>/g, " ");
    return [{ id: piece.id || id, reference: piece.reference, text: plainEntities(text).replace(/\s+/g, " ").trim() }];
  }
  return verses.map((one) => ({ id: `${book}.${chapter}.${one.verse}`, reference: piece.reference, text: one.text }));
}

/** The verse numbers a part's id names: "JHN.3.16" 16 to 16, "JHN.3.16-18" 16 to 18, "JHN.3" none. */
function partVerses(id: string): { from: number; to: number } | null {
  const found = /^[^.]+\.\d+\.(\d+)(?:-(\d+))?$/.exec(id);
  if (!found) return null;
  const from = Number(found[1]);
  return { from, to: found[2] ? Number(found[2]) : from };
}

/**
 * A reference's text in a version, as plain text: one request a chapter it
 * touches (`piece` asks it: the service keeps or shares answers), verse by
 * verse. Never stored here.
 */
export async function youVersionPassage(
  bibleId: number,
  reference: BibleReference,
  appKey: string,
  fetcher: Fetcher = fetch,
  piece: (id: string) => Promise<YouVersionPassagePart[]> = (id) => youVersionPiece(bibleId, id, appKey, fetcher),
): Promise<YouVersionPassagePart[]> {
  const found: YouVersionPassagePart[] = [];
  for (const ask of youVersionAsks(reference)) {
    for (const part of await piece(ask.id)) {
      const verses = partVerses(part.id);
      if (verses && ((ask.from !== null && verses.to < ask.from) || (ask.to !== null && verses.from > ask.to))) continue;
      if (!found.some((one) => one.id === part.id)) found.push(part);
    }
  }
  return found;
}
