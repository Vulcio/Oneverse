/**
 * The songbook catalogue file format: one list of fields, read and written
 * as CSV (for spreadsheets) or JSON (for exact round trips, and catalogue
 * details plus entries in one file). Documented for people in
 * docs/songbook-catalog-format.md - keep the two in step.
 *
 * Import rules, whichever the format:
 * - Columns (CSV) or keys (JSON) are matched by name, ignoring case, spaces
 *   and punctuation, with a few aliases ("SongNumber" or "No" for Number,
 *   "Author" for Lyricist...). Unknown ones are reported and ignored.
 * - A column that's absent leaves that field alone on existing entries; an
 *   empty cell (or null) clears it.
 * - Rows are matched to existing entries by Number.
 */

import { validateSongbookSections, type SongbookSection } from "../songbook-sections/index.js";
import { readReferenceLink } from "../streaming-links/reference.js";

export type CatalogFieldKind = "text" | "int" | "list" | "duration" | "links";

export interface CatalogFieldDef {
  key: CatalogEntryFieldKey;
  /** CSV header written on export (JSON uses `jsonKey`). */
  header: string;
  jsonKey: string;
  /** Other accepted names, besides `header`, `jsonKey` and `key`. */
  aliases: readonly string[];
  kind: CatalogFieldKind;
  required?: boolean;
  /** Max characters for text; max items for a list. */
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternHint?: string;
}

export const CATALOG_ENTRY_FIELD_KEYS = [
  "entryCode",
  "title",
  "sortTitle",
  "subtitle",
  "originalSong",
  "originalLanguage",
  "artist",
  "composer",
  "lyricist",
  "album",
  "year",
  "key",
  "timeSignature",
  "tempo",
  "durationSeconds",
  "copyright",
  "ccli",
  "isrc",
  "reference",
  "tags",
  "links",
  "notes",
] as const;
export type CatalogEntryFieldKey = (typeof CATALOG_ENTRY_FIELD_KEYS)[number];

const TAG_MAX_LENGTH = 50;
const LINKS_MAX = 10;

/** What the Links field takes (issue #210): a recording on one of these. */
export const CATALOG_LINK_SERVICES = ["YOUTUBE", "SPOTIFY", "APPLE_MUSIC", "DEEZER"] as const;
export type CatalogLinkService = (typeof CATALOG_LINK_SERVICES)[number];

/**
 * An entry's links as written in a file (issue #210): addresses separated
 * by semicolons, spaces or new lines (or a JSON list), each read for its
 * service by its host. Kept as the address to open, rebuilt from the ID,
 * repeats dropped; one on any other site is refused, by its address.
 */
export function readCatalogLinks(raw: string | readonly string[]): { links: { service: CatalogLinkService; url: string }[]; refused: string[] } {
  const parts = (typeof raw === "string" ? [raw] : raw).flatMap((item) => item.split(/[;\s]+/)).filter(Boolean);
  const links: { service: CatalogLinkService; url: string }[] = [];
  const refused: string[] = [];
  for (const part of parts) {
    const link = readReferenceLink(part);
    if (!link || link.service === "OTHER") refused.push(part);
    else if (!links.some((existing) => existing.url === link.url)) links.push({ service: link.service, url: link.url });
  }
  return { links, refused };
}

/** In export column order. */
export const CATALOG_ENTRY_FIELDS: readonly CatalogFieldDef[] = [
  { key: "entryCode", header: "Number", jsonKey: "number", aliases: ["SongNumber", "No", "Nr", "Num", "Code", "EntryCode"], kind: "text", required: true, maxLength: 20 },
  { key: "title", header: "Title", jsonKey: "title", aliases: ["SongTitle", "Name"], kind: "text", required: true, maxLength: 300 },
  { key: "sortTitle", header: "SortTitle", jsonKey: "sortTitle", aliases: ["Sort"], kind: "text", maxLength: 300 },
  { key: "subtitle", header: "Subtitle", jsonKey: "subtitle", aliases: ["AlternateTitle", "FirstLine"], kind: "text", maxLength: 300 },
  { key: "originalSong", header: "OriginalSong", jsonKey: "originalSong", aliases: ["Original"], kind: "text", maxLength: 120 },
  { key: "originalLanguage", header: "Language", jsonKey: "language", aliases: ["OriginalLanguage", "Lang"], kind: "text", maxLength: 35 },
  { key: "artist", header: "Artist", jsonKey: "artist", aliases: ["Performer", "Band"], kind: "text", maxLength: 300 },
  { key: "composer", header: "Composer", jsonKey: "composer", aliases: ["Music", "MusicBy"], kind: "text", maxLength: 300 },
  { key: "lyricist", header: "Lyricist", jsonKey: "lyricist", aliases: ["Author", "Lyrics", "Words", "WordsBy"], kind: "text", maxLength: 300 },
  { key: "album", header: "Album", jsonKey: "album", aliases: [], kind: "text", maxLength: 300 },
  { key: "year", header: "Year", jsonKey: "year", aliases: ["CopyrightYear"], kind: "int", min: 1000, max: 2999 },
  { key: "key", header: "Key", jsonKey: "key", aliases: ["MusicalKey", "Tonality"], kind: "text", maxLength: 12 },
  {
    key: "timeSignature",
    header: "Time",
    jsonKey: "time",
    aliases: ["TimeSignature", "Meter"],
    kind: "text",
    maxLength: 5,
    pattern: /^\d{1,2}\/\d{1,2}$/,
    patternHint: "like 4/4 or 6/8",
  },
  { key: "tempo", header: "Tempo", jsonKey: "tempo", aliases: ["BPM"], kind: "int", min: 20, max: 400 },
  { key: "durationSeconds", header: "Duration", jsonKey: "duration", aliases: ["Runtime", "Length", "Time Length"], kind: "duration", min: 1, max: 36000 },
  { key: "copyright", header: "Copyright", jsonKey: "copyright", aliases: [], kind: "text", maxLength: 500 },
  { key: "ccli", header: "CCLI", jsonKey: "ccli", aliases: ["CCLINumber", "SongSelect"], kind: "text", maxLength: 20 },
  {
    key: "isrc",
    header: "ISRC",
    jsonKey: "isrc",
    aliases: ["ISRCCode"],
    kind: "text",
    maxLength: 15,
    pattern: /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/,
    patternHint: "12 characters like USRC17607839; dashes are fine",
  },
  { key: "reference", header: "Reference", jsonKey: "reference", aliases: ["Scripture", "BibleReference"], kind: "text", maxLength: 300 },
  { key: "tags", header: "Tags", jsonKey: "tags", aliases: ["Themes", "Keywords"], kind: "list", maxLength: 30 },
  {
    key: "links",
    header: "Links",
    jsonKey: "links",
    // Each service's column is one more Links column: they're all read together (issue #210).
    aliases: ["Link", "Listen", "YouTube", "Spotify", "AppleMusic", "Apple", "iTunes", "Deezer"],
    kind: "links",
    maxLength: LINKS_MAX,
  },
  { key: "notes", header: "Notes", jsonKey: "notes", aliases: ["Comments"], kind: "text", maxLength: 2000 },
];

export const CATALOG_FIELD_BY_KEY = Object.fromEntries(CATALOG_ENTRY_FIELDS.map((field) => [field.key, field])) as Record<
  CatalogEntryFieldKey,
  CatalogFieldDef
>;

/** Every field of an entry; optional ones are null (or [] for tags and links) when unset. */
export interface CatalogEntryData {
  entryCode: string;
  title: string;
  sortTitle: string | null;
  subtitle: string | null;
  originalSong: string | null;
  originalLanguage: string | null;
  artist: string | null;
  composer: string | null;
  lyricist: string | null;
  album: string | null;
  year: number | null;
  key: string | null;
  timeSignature: string | null;
  tempo: number | null;
  /** Running time in seconds; written as m:ss in files. */
  durationSeconds: number | null;
  copyright: string | null;
  ccli: string | null;
  /** Compact form: USRC17607839. */
  isrc: string | null;
  reference: string | null;
  tags: string[];
  /** Recordings on YouTube, Spotify, Apple Music or Deezer (issue #210), as addresses to open. */
  links: string[];
  notes: string | null;
}

/** Just the fields a file (or an edit) sets; absent ones are left alone. */
export type CatalogEntryPatch = Partial<CatalogEntryData>;

/** Catalogue details carried by a JSON file. */
export interface CatalogDetailsInput {
  name?: string;
  abbreviation?: string | null;
  publisher?: string | null;
  isbn?: string | null;
  description?: string | null;
  officialUrl?: string | null;
  language?: string | null;
  /** The printed volumes' number ranges (issue #55); JSON files only. */
  sections?: SongbookSection[] | null;
}

const CATALOG_DETAIL_KEYS = ["name", "abbreviation", "publisher", "isbn", "description", "officialUrl", "language"] as const;

export interface CatalogFileRow {
  /** Row number as a person would count it: the CSV line (header is 1) or the JSON entry's position (from 1). */
  row: number;
  data: CatalogEntryPatch;
}

export interface CatalogFileProblem {
  /** Null for a problem with the file as a whole. */
  row: number | null;
  message: string;
}

export interface ParsedCatalogFile {
  format: "csv" | "json";
  /** Fields present in the file, in file order. */
  fields: CatalogEntryFieldKey[];
  /** Valid rows only; rows with problems are listed in `problems` and left out. */
  rows: CatalogFileRow[];
  problems: CatalogFileProblem[];
  /** Columns or keys that aren't catalogue fields. */
  unknownColumns: string[];
  /** Only from a JSON file that includes them. */
  details: CatalogDetailsInput | null;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FIELD_BY_NAME = new Map<string, CatalogFieldDef>();
for (const field of CATALOG_ENTRY_FIELDS) {
  for (const name of [field.header, field.jsonKey, field.key, ...field.aliases]) {
    FIELD_BY_NAME.set(normalizeName(name), field);
  }
}

/** The field a CSV header or JSON key refers to, if any. */
export function catalogFieldForName(name: string): CatalogFieldDef | undefined {
  return FIELD_BY_NAME.get(normalizeName(name));
}

type Normalized = { ok: true; value: string | number | string[] | null } | { ok: false; message: string };

/**
 * Validates one field's value from a file cell (a string) or JSON (any
 * type) and puts it in stored form: trimmed text, whole numbers, a
 * de-duplicated tag list. Empty means "clear" (null, or [] for tags).
 */
export function normalizeCatalogValue(field: CatalogFieldDef, raw: unknown): Normalized {
  const label = field.header;
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    if (field.required) return { ok: false, message: `${label} is required` };
    return { ok: true, value: field.kind === "list" || field.kind === "links" ? [] : null };
  }

  if (field.kind === "links") {
    const items = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : null;
    if (!items || !items.every((item) => typeof item === "string")) return { ok: false, message: `${label} must be a list of addresses` };
    const { links, refused } = readCatalogLinks(items);
    if (refused.length > 0) {
      const shown = refused[0]!.length > 60 ? `${refused[0]!.slice(0, 60)}…` : refused[0]!;
      return { ok: false, message: `${label}: "${shown}" isn't a YouTube, Spotify, Apple Music or Deezer address` };
    }
    if (field.maxLength && links.length > field.maxLength) return { ok: false, message: `${label}: at most ${field.maxLength}` };
    return { ok: true, value: links.map((link) => link.url) };
  }

  if (field.kind === "list") {
    const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[;|,]/) : null;
    if (!items || !items.every((item) => typeof item === "string" || typeof item === "number")) {
      return { ok: false, message: `${label} must be a list of words` };
    }
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const item of items) {
      const tag = String(item).trim();
      if (!tag || seen.has(tag.toLowerCase())) continue;
      if (tag.length > TAG_MAX_LENGTH) return { ok: false, message: `${label}: "${tag.slice(0, 20)}…" is longer than ${TAG_MAX_LENGTH} characters` };
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
    if (field.maxLength && tags.length > field.maxLength) return { ok: false, message: `${label}: at most ${field.maxLength}` };
    return { ok: true, value: tags };
  }

  if (field.kind === "duration") {
    const seconds = typeof raw === "number" ? raw : typeof raw === "string" ? parseDuration(raw) : null;
    if (seconds === null || !Number.isInteger(seconds)) return { ok: false, message: `${label} must be like 3:45 (or a number of seconds)` };
    if ((field.min !== undefined && seconds < field.min) || (field.max !== undefined && seconds > field.max)) {
      return { ok: false, message: `${label} must be between 0:01 and ${formatDuration(field.max ?? 0)}` };
    }
    return { ok: true, value: seconds };
  }

  if (field.kind === "int") {
    const number = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*-?\d+\s*$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(number)) return { ok: false, message: `${label} must be a whole number` };
    if ((field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) {
      return { ok: false, message: `${label} must be between ${field.min} and ${field.max}` };
    }
    return { ok: true, value: number };
  }

  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, message: `${label} must be text` };
  // Notes keep their line breaks; everything else is one line. ISRCs are
  // stored compact and upper-case, however they were written.
  const text =
    field.key === "entryCode"
      ? normalizeEntryCode(String(raw).replace(/\s+/g, " "))
      : field.key === "notes"
      ? String(raw).trim().replace(/\r\n?/g, "\n")
      : field.key === "isrc"
        ? String(raw).replace(/[\s-]/g, "").toUpperCase()
        : String(raw).trim().replace(/\s+/g, " ");
  if (field.maxLength && text.length > field.maxLength) return { ok: false, message: `${label} is longer than ${field.maxLength} characters` };
  if (field.pattern && !field.pattern.test(text)) return { ok: false, message: `${label} "${text}" isn't valid (${field.patternHint})` };
  return { ok: true, value: text };
}

/** Validates a partial entry (e.g. one edited cell); returns the stored values or the problems. */
export function validateCatalogEntryPatch(input: Record<string, unknown>): { data: CatalogEntryPatch; problems: string[] } {
  const data: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const [name, raw] of Object.entries(input)) {
    if (raw === undefined) continue;
    const field = catalogFieldForName(name);
    if (!field) continue;
    const result = normalizeCatalogValue(field, raw);
    if (result.ok) data[field.key] = result.value;
    else problems.push(result.message);
  }
  return { data: data as CatalogEntryPatch, problems };
}

// ---------------------------------------------------------------- CSV

/** The delimiter used by a CSV's header line: comma, semicolon (common from European Excel) or tab. */
export function detectCsvDelimiter(text: string): "," | ";" | "\t" {
  const headerLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const char of headerLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char as keyof typeof counts]++;
  }
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","]) return "\t";
  return ",";
}

/**
 * RFC 4180-style CSV: quoted fields (with "" for a quote), delimiters and
 * newlines inside quotes, \r\n or \n line endings. Blank lines are dropped.
 */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCatalogCsv(input: string): ParsedCatalogFile {
  const text = stripBom(input);
  const rows = parseCsv(text, detectCsvDelimiter(text));
  const result: ParsedCatalogFile = { format: "csv", fields: [], rows: [], problems: [], unknownColumns: [], details: null };
  const header = rows[0];
  if (!header) {
    result.problems.push({ row: null, message: "The file is empty" });
    return result;
  }

  const columns: (CatalogFieldDef | null)[] = [];
  for (const name of header) {
    const field = catalogFieldForName(name);
    if (!field) {
      if (name.trim()) result.unknownColumns.push(name.trim());
      columns.push(null);
    } else if (result.fields.includes(field.key) && field.kind === "links") {
      columns.push(field);
    } else if (result.fields.includes(field.key)) {
      result.problems.push({ row: null, message: `Two columns are both ${field.header} ("${name.trim()}")` });
      columns.push(null);
    } else {
      result.fields.push(field.key);
      columns.push(field);
    }
  }
  if (!result.fields.includes("entryCode")) {
    result.problems.push({ row: null, message: "There's no Number column (the header row must name the columns)" });
    return result;
  }

  rows.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    if (cells.every((cell) => cell.trim() === "")) return;
    collectRow(result, rowNumber, columns.map((field, column) => [field, cells[column] ?? ""] as const));
  });
  return result;
}

function collectRow(result: ParsedCatalogFile, row: number, values: readonly (readonly [CatalogFieldDef | null, unknown])[]): void {
  const data: Record<string, unknown> = {};
  const messages: string[] = [];
  // Several Links columns (or YouTube, Spotify...) are one field: their addresses read together.
  const grouped: (readonly [CatalogFieldDef | null, unknown])[] = [];
  for (const [field, raw] of values) {
    const earlier = field?.kind === "links" ? grouped.findIndex(([other]) => other === field) : -1;
    if (earlier < 0) grouped.push([field, raw]);
    else grouped[earlier] = [field, [grouped[earlier]![1], raw].flat().filter((item) => item !== null && item !== undefined)];
  }
  for (const [field, raw] of grouped) {
    if (!field) continue;
    const normalized = normalizeCatalogValue(field, raw);
    if (normalized.ok) data[field.key] = normalized.value;
    else messages.push(normalized.message);
  }
  if (messages.length > 0) result.problems.push({ row, message: messages.join("; ") });
  else result.rows.push({ row, data: data as CatalogEntryPatch });
}

function csvCell(value: string): string {
  return /[",;\t\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function exportValue(field: CatalogFieldDef, value: CatalogEntryData[CatalogEntryFieldKey]): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (field.kind === "duration" && typeof value === "number") return formatDuration(value);
  return String(value);
}

/**
 * Every field, comma-separated, CRLF line endings, with a byte-order mark
 * so Excel reads accented text as UTF-8. Reads back with parseCatalogCsv.
 */
export function serializeCatalogCsv(entries: readonly CatalogEntryData[]): string {
  const lines = [CATALOG_ENTRY_FIELDS.map((field) => field.header).join(",")];
  for (const entry of entries) {
    lines.push(CATALOG_ENTRY_FIELDS.map((field) => csvCell(exportValue(field, entry[field.key]))).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------- JSON

export const CATALOG_JSON_FORMAT = "songverse-songbook-catalog";
export const CATALOG_JSON_VERSION = 1;

/** Accepts `{ format, version, catalog?, entries: [...] }`, or just the array of entries. */
export function parseCatalogJson(text: string): ParsedCatalogFile {
  const result: ParsedCatalogFile = { format: "json", fields: [], rows: [], problems: [], unknownColumns: [], details: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch (error) {
    result.problems.push({ row: null, message: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` });
    return result;
  }

  let entries: unknown;
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (parsed && typeof parsed === "object") {
    const file = parsed as Record<string, unknown>;
    if (typeof file.version === "number" && file.version > CATALOG_JSON_VERSION) {
      result.problems.push({ row: null, message: `This file is format version ${file.version}; this Songverse reads up to ${CATALOG_JSON_VERSION}` });
      return result;
    }
    entries = file.entries;
    if (file.catalog && typeof file.catalog === "object") result.details = readDetails(file.catalog as Record<string, unknown>, result);
  }
  if (!Array.isArray(entries)) {
    result.problems.push({ row: null, message: 'Expected an "entries" list' });
    return result;
  }

  const unknown = new Set<string>();
  entries.forEach((entry, index) => {
    const row = index + 1;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      result.problems.push({ row, message: "Each entry must be an object" });
      return;
    }
    const values: [CatalogFieldDef | null, unknown][] = [];
    const seen = new Set<CatalogEntryFieldKey>();
    for (const [name, raw] of Object.entries(entry as Record<string, unknown>)) {
      const field = catalogFieldForName(name);
      if (!field) {
        unknown.add(name);
        continue;
      }
      if (seen.has(field.key) && field.kind !== "links") continue;
      seen.add(field.key);
      if (!result.fields.includes(field.key)) result.fields.push(field.key);
      values.push([field, raw]);
    }
    if (!seen.has("entryCode")) {
      result.problems.push({ row, message: "Number is required" });
      return;
    }
    collectRow(result, row, values);
  });
  result.unknownColumns = [...unknown];
  return result;
}

function readDetails(input: Record<string, unknown>, result: ParsedCatalogFile): CatalogDetailsInput {
  const details: CatalogDetailsInput = {};
  for (const key of CATALOG_DETAIL_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") {
      result.problems.push({ row: null, message: `catalog.${key} must be text` });
      continue;
    }
    const text = value?.trim() || null;
    if (key === "name") {
      if (text) details.name = text;
    } else {
      details[key] = text;
    }
  }
  if (input.sections !== undefined && input.sections !== null) {
    try {
      details.sections = validateSongbookSections(input.sections);
    } catch (error) {
      result.problems.push({ row: null, message: `catalog.sections: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return details;
}

export function serializeCatalogJson(details: Required<CatalogDetailsInput>, entries: readonly CatalogEntryData[]): string {
  const file = {
    format: CATALOG_JSON_FORMAT,
    version: CATALOG_JSON_VERSION,
    catalog: { ...Object.fromEntries(CATALOG_DETAIL_KEYS.map((key) => [key, details[key]])), sections: details.sections ?? [] },
    entries: entries.map((entry) => Object.fromEntries(CATALOG_ENTRY_FIELDS.map((field) => [field.jsonKey, entry[field.key]]))),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Picks the reader from the file name, or failing that from the content. */
export function parseCatalogFile(text: string, filename?: string): ParsedCatalogFile {
  const lower = filename?.toLowerCase() ?? "";
  if (lower.endsWith(".json")) return parseCatalogJson(text);
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) return parseCatalogCsv(text);
  const start = stripBom(text).trimStart()[0];
  return start === "{" || start === "[" ? parseCatalogJson(text) : parseCatalogCsv(text);
}

// ---------------------------------------------------------------- helpers

/** "3:45", "1:02:03" or plain seconds ("225") to seconds; null if it isn't one of those. */
export function parseDuration(text: string): number | null {
  const value = text.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  if (Number(seconds) > 59 || (hours !== undefined && Number(minutes) > 59)) return null;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** Seconds as m:ss, or h:mm:ss from an hour up (whole seconds, never below 0): durations, and a player's position. */
export function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/**
 * Several people in one credit, separated by semicolons: "Hillsong Worship;
 * Brooke Ligertwood". Trimmed, blanks and repeats (ignoring case) dropped.
 */
export function splitNames(text: string | null | undefined): string[] {
  const names: string[] = [];
  for (const part of (text ?? "").split(";")) {
    const name = part.trim().replace(/\s+/g, " ");
    if (name && !names.some((existing) => existing.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names;
}

/**
 * An entry number as stored (issue #55): a plain number without leading
 * zeros ("0245" is "245", "000" is "0"); a code with letters ("A-17",
 * "FR-092") as printed.
 */
export function normalizeEntryCode(code: string): string {
  const trimmed = code.trim();
  return /^\d+$/.test(trimmed) ? trimmed.replace(/^0+(?=\d)/, "") : trimmed;
}

/** Entry numbers in reading order: 2 before 10, "12a" after "12". */
export function compareEntryCodes(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * An "Original song" written as another entry's catalogue abbreviation and
 * number - "JEM 245", "JEM245", "JEM:245" - or just a number (in the same
 * catalogue). Null when it doesn't look like one (plain text).
 */
export function parseOriginalSongReference(text: string): { abbreviation: string | null; entryCode: string } | null {
  const value = text.trim();
  const spaced = /^(?:(.+?)[\s:#]+)?([A-Za-z]?\d+[A-Za-z]?)$/.exec(value);
  if (spaced) return { abbreviation: spaced[1]?.trim() || null, entryCode: normalizeEntryCode(spaced[2]!) };
  const joined = /^([A-Za-z][A-Za-z&.'-]*)(\d+[A-Za-z]?)$/.exec(value);
  if (joined) return { abbreviation: joined[1]!, entryCode: normalizeEntryCode(joined[2]!) };
  return null;
}

/** An empty entry with just a number and title, for filling in. */
export function emptyCatalogEntry(entryCode: string, title: string): CatalogEntryData {
  return {
    entryCode,
    title,
    sortTitle: null,
    subtitle: null,
    originalSong: null,
    originalLanguage: null,
    artist: null,
    composer: null,
    lyricist: null,
    album: null,
    year: null,
    key: null,
    timeSignature: null,
    tempo: null,
    durationSeconds: null,
    copyright: null,
    ccli: null,
    isrc: null,
    reference: null,
    tags: [],
    links: [],
    notes: null,
  };
}
