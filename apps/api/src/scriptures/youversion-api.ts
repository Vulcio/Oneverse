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

/** How many verses one passage may ask for, one request each. */
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

interface VerseJson {
  id: string;
  passage_id: string;
  title?: string;
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

export async function youVersionBibleById(id: number, appKey: string, fetcher: Fetcher = fetch): Promise<YouVersionBible> {
  return youVersionBible(await get<YouVersionBibleJson>(`/v1/bibles/${id}`, appKey, fetcher));
}

/**
 * A reference's text in a version, as plain text: a whole chapter in one
 * request, verses one request each (only single verses and chapters are
 * documented as passage ids, not ranges), a chapter's verse list asked
 * first to know which it has. Never stored: what a version's licence allows
 * isn't known yet.
 */
export async function youVersionPassage(bibleId: number, reference: BibleReference, appKey: string, fetcher: Fetcher = fetch): Promise<YouVersionPassagePart[]> {
  const parts = usfmChapterParts(reference);
  if (!parts) throw new YouVersionApiError(400, "A passage is a chapter or verses of one book, not a whole book");
  const passage = (id: string) => get<PassageJson>(`/v1/bibles/${bibleId}/passages/${encodeURIComponent(id)}?format=text`, appKey, fetcher);
  const ids: string[] = [];
  for (const part of parts) {
    if (part.from === null && part.to === null) {
      ids.push(usfmPassageId(part.book, part.chapter));
      continue;
    }
    if (part.from !== null && part.from === part.to) {
      ids.push(usfmPassageId(part.book, part.chapter, part.from));
      continue;
    }
    const verses = await get<{ data?: VerseJson[] }>(`/v1/bibles/${bibleId}/books/${part.book}/chapters/${part.chapter}/verses`, appKey, fetcher);
    for (const verse of verses.data ?? []) {
      const number = Number.parseInt(verse.id, 10);
      if (Number.isInteger(number) && number >= (part.from ?? 0) && number <= (part.to ?? Number.MAX_SAFE_INTEGER)) ids.push(verse.passage_id);
    }
  }
  const unique = [...new Set(ids)];
  if (unique.length > MAX_YOUVERSION_REQUESTS) throw new YouVersionApiError(400, `A passage from YouVersion is ${MAX_YOUVERSION_REQUESTS} verses or chapters at most`);
  const found: YouVersionPassagePart[] = [];
  for (const id of unique) {
    const piece = await passage(id);
    found.push({ id: piece.id, reference: piece.reference, text: piece.content.replace(/\s+/g, " ").trim() });
  }
  return found;
}
