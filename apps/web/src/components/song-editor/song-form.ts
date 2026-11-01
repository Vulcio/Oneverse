import {
  detectImportFormat,
  formatDuration,
  parseDuration,
  reconcileFlow,
  transposeKey,
  sectionsToChordPro,
  songDocumentFromText,
  type CreateSongVersionInput,
  type SectionInstance,
  type SongInfoCurrent,
  type SectionV2,
  type SongDocumentV2,
  type SongVersionDetail,
  type SupportedImportFormat,
  type UpdateSongVersionInput,
  type LanguageCode,
} from "@oneverse/core";
import { sameFlow, sameSections } from "./structured/document";

/** The credit lists the editor edits, and the role each one is. */
export const CREDIT_FIELDS = {
  artists: "PERFORMER",
  composers: "COMPOSER",
  lyricists: "LYRICIST",
  writers: "AUTHOR",
  arrangers: "ARRANGER",
  translators: "TRANSLATOR",
  adaptors: "ADAPTOR",
} as const;
export type CreditField = keyof typeof CREDIT_FIELDS;

const TEXT_FIELDS = [
  "title",
  "versionName",
  "alternateTitle",
  "sortTitle",
  "language",
  "album",
  "year",
  "key",
  "tempo",
  "timeSignature",
  "capo",
  "duration",
  "copyright",
  "ccli",
  "isrc",
  "reference",
  "notes",
] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

/** Everything the editor edits, as the inputs hold it (text, mostly). */
export type SongForm = Record<TextField, string> &
  Record<CreditField, string[]> & {
    tagIds: string[];
    /** The chart, as saved: what the Editor tab edits, IDs and all. */
    sections: SectionV2[];
    /** The order they're sung in: repeats, and each pass's label, key change and note. */
    flow: SectionInstance[];
    /** The chart as text, for Song Info's text box: kept in step with `sections` (see withContent/withSections). */
    content: string;
    /** The format picked by hand; null to go by what the text looks like. */
    contentFormat: SupportedImportFormat | null;
  };

export function emptyForm(language: string): SongForm {
  return {
    ...(Object.fromEntries(TEXT_FIELDS.map((field) => [field, ""])) as Record<TextField, string>),
    ...(Object.fromEntries(Object.keys(CREDIT_FIELDS).map((field) => [field, []])) as unknown as Record<CreditField, string[]>),
    language,
    tagIds: [],
    sections: [],
    flow: [],
    content: "",
    contentFormat: null,
  };
}

function creditNames(version: SongVersionDetail, role: string): string[] {
  return version.contributors.filter((c) => c.roles.includes(role) && c.source).map((c) => c.source!);
}

export function formFromVersion(version: SongVersionDetail): SongForm {
  const defaults = version.documentJson.defaults;
  return {
    title: version.title,
    versionName: version.versionName ?? "",
    alternateTitle: version.alternateTitle ?? "",
    sortTitle: version.sortTitle ?? "",
    language: version.language,
    album: version.album ?? "",
    year: version.year?.toString() ?? "",
    key: defaults.key ?? "",
    tempo: defaults.tempo?.toString() ?? "",
    timeSignature: defaults.timeSignature ? `${defaults.timeSignature.numerator}/${defaults.timeSignature.denominator}` : "",
    capo: version.capo ? String(version.capo) : "",
    duration: defaults.durationSeconds ? formatDuration(defaults.durationSeconds) : "",
    copyright: version.copyright ?? "",
    ccli: version.ccli ?? "",
    isrc: version.isrc ?? "",
    reference: version.reference ?? "",
    notes: version.notes ?? "",
    ...(Object.fromEntries(
      Object.entries(CREDIT_FIELDS).map(([field, role]) => [field, creditNames(version, role)]),
    ) as unknown as Record<CreditField, string[]>),
    tagIds: version.tags.map((tag) => tag.id),
    sections: version.documentJson.sections,
    flow: version.documentJson.flow,
    content: sectionsToChordPro(version.documentJson.sections),
    contentFormat: null,
  };
}

/** The song as the form has it, for what a match would fill in (issue #352). */
export function songInfoFromForm(form: SongForm, hasImage: boolean): SongInfoCurrent {
  const number = (text: string) => (text.trim() && Number.isFinite(Number(text)) ? Number(text) : null);
  return {
    title: form.title.trim(),
    artists: form.artists,
    writers: [...form.writers, ...form.composers, ...form.lyricists],
    album: form.album.trim() || null,
    year: number(form.year),
    isrc: form.isrc.trim() || null,
    tempo: number(form.tempo),
    durationSeconds: form.duration.trim() ? parseDuration(form.duration) : null,
    hasImage,
  };
}

/** The form's chart as a document, for the core helpers that work on one. */
function chartOf(form: SongForm): SongDocumentV2 {
  return { $schema: "song-document/v2", revision: 0, defaults: {}, sections: form.sections, flow: form.flow };
}

/**
 * The chart typed or pasted as text: read into sections, keeping the IDs of
 * what's still there, and the order it's sung in ("{chorus}" repeats; a
 * hand-set order otherwise keeps its shape).
 */
export function withContent(form: SongForm, content: string, contentFormat: SupportedImportFormat | null): SongForm {
  try {
    const doc = songDocumentFromText(chartOf(form), { content, format: effectiveFormat({ content, contentFormat }) });
    return { ...form, content, contentFormat, sections: doc.sections, flow: doc.flow };
  } catch {
    // Text that can't be read yet leaves the chart as it was.
    return { ...form, content, contentFormat };
  }
}

/** The chart edited in the Editor tab: the order follows added and deleted sections, and the text follows as ChordPro. */
export function withSections(form: SongForm, sections: SectionV2[]): SongForm {
  return { ...form, sections, flow: reconcileFlow(chartOf(form), sections), content: sectionsToChordPro(sections), contentFormat: null };
}

/**
 * Key changes named for the key they reach: each is a number of semitones
 * from the key before it, so changing the song's key (or an earlier change)
 * renames every one after.
 */
export function nameKeyChanges(flow: SectionInstance[], songKey: string): SectionInstance[] {
  let key: string | null = songKey || null;
  return flow.map((item) => {
    if (!item.keyChange) return item;
    const name = key ? transposeKey(key, item.keyChange.steps) : null;
    key = name ?? item.keyChange.key;
    return name && name !== item.keyChange.key ? { ...item, keyChange: { ...item.keyChange, key: name } } : item;
  });
}

/** The format the content will be read as. */
export function effectiveFormat(form: Pick<SongForm, "content" | "contentFormat">): SupportedImportFormat {
  return form.contentFormat ?? detectImportFormat(form.content);
}

export type FormError =
  | "titleRequired"
  | "artistRequired"
  | "yearInvalid"
  | "tempoInvalid"
  | "durationInvalid"
  | "isrcInvalid";

/** Problems by field, the same rules the API checks. */
export function validate(form: SongForm): Partial<Record<TextField | "artists", FormError>> {
  const errors: Partial<Record<TextField | "artists", FormError>> = {};
  if (!form.title.trim()) errors.title = "titleRequired";
  if (form.artists.length === 0) errors.artists = "artistRequired";
  const year = form.year.trim();
  if (year && (!/^\d{4}$/.test(year) || Number(year) < 1000 || Number(year) > 2999)) errors.year = "yearInvalid";
  const tempo = form.tempo.trim();
  if (tempo && (!/^\d+$/.test(tempo) || Number(tempo) < 20 || Number(tempo) > 400)) errors.tempo = "tempoInvalid";
  if (form.duration.trim() && parseDuration(form.duration.trim()) === null) errors.duration = "durationInvalid";
  if (form.isrc.trim() && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(form.isrc.replace(/[\s-]/g, "").toUpperCase())) errors.isrc = "isrcInvalid";
  return errors;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Whether a field differs from how it started. */
export function fieldChanged(form: SongForm, initial: SongForm, field: keyof SongForm): boolean {
  const a = form[field];
  const b = initial[field];
  if (field === "sections") return !sameSections(form.sections, initial.sections);
  if (field === "flow") return !sameFlow(form.flow, initial.flow);
  // The text is only a view of the sections.
  if (field === "content" || field === "contentFormat") return false;
  if (Array.isArray(a) && Array.isArray(b)) return !sameList(a as string[], b as string[]);
  return (a ?? "").toString().trim() !== (b ?? "").toString().trim();
}

export function isDirty(form: SongForm, initial: SongForm): boolean {
  return (Object.keys(form) as (keyof SongForm)[]).some((field) => fieldChanged(form, initial, field));
}

function textValue(form: SongForm, field: TextField): string | number | null {
  const text = form[field].trim();
  switch (field) {
    case "year":
    case "tempo":
      return text ? Number(text) : null;
    case "capo":
      return text ? Number(text) : null;
    default:
      return text || null;
  }
}

/** What the API takes for the fields that changed (all of them, against an empty form). */
function changedFields(form: SongForm, initial: SongForm): UpdateSongVersionInput {
  const data: Record<string, unknown> = {};
  for (const field of TEXT_FIELDS) {
    if (!fieldChanged(form, initial, field)) continue;
    if (field === "duration") data.durationSeconds = form.duration.trim() ? parseDuration(form.duration.trim()) : null;
    else if (field === "title" || field === "language") data[field] = form[field].trim();
    else data[field] = textValue(form, field);
  }
  for (const field of Object.keys(CREDIT_FIELDS) as CreditField[]) {
    if (fieldChanged(form, initial, field)) data[field] = form[field];
  }
  if (fieldChanged(form, initial, "tagIds")) data.tagIds = form.tagIds;
  if (fieldChanged(form, initial, "sections")) data.sections = form.sections;
  if (fieldChanged(form, initial, "flow")) data.flow = form.flow;
  return data as UpdateSongVersionInput;
}

export function toCreateInput(form: SongForm): CreateSongVersionInput {
  const blank = emptyForm(form.language);
  blank.language = "";
  const data = changedFields(form, blank);
  return { ...data, title: form.title.trim(), language: form.language as LanguageCode, artists: form.artists };
}

export function toUpdateInput(form: SongForm, initial: SongForm): UpdateSongVersionInput {
  return changedFields(form, initial);
}

/** Copies a song's details into the fields still empty (for "Use as base"). */
export function fillFrom(form: SongForm, source: SongForm): SongForm {
  const next = { ...form };
  for (const field of TEXT_FIELDS) {
    if (field === "versionName") continue;
    if (!next[field].trim()) next[field] = source[field];
  }
  for (const field of Object.keys(CREDIT_FIELDS) as CreditField[]) {
    if (next[field].length === 0) next[field] = source[field];
  }
  if (next.tagIds.length === 0) next.tagIds = source.tagIds;
  if (next.sections.length === 0) {
    next.sections = source.sections;
    next.flow = source.flow;
    next.content = source.content;
  }
  return next;
}

export const KEY_OPTIONS = {
  major: ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"],
  minor: ["Cm", "C#m", "Dm", "D#m", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"],
};

export const TIME_SIGNATURE_OPTIONS = ["2/2", "2/4", "3/4", "4/4", "5/4", "6/4", "3/8", "6/8", "7/8", "9/8", "12/8"];

export const CAPO_OPTIONS = Array.from({ length: 11 }, (_, index) => String(index + 1));
