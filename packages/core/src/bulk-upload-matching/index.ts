/**
 * Filename -> songbook entry number matching for bulk content upload (see
 * docs/songbooks-and-catalog.md §7). Matching is number-first, not
 * fuzzy-first: title-similarity matching isn't reliable enough to run
 * unattended at volume (e.g. "Amazing Grace" vs. "Amazing Grace
 * (Reprise)"), so this only ever looks at the numeric token in the
 * filename ("0245.cho", "JEM_0245.pdf" -> "245").
 */

import { CHART_FILE_EXTENSIONS } from "../import-detection/song-details.js";

export type BulkUploadMatchStatus = "MATCHED" | "UNMATCHED" | "DUPLICATE" | "IGNORED";

export interface BulkUploadFileMatch {
  filename: string;
  entryCode: string | null;
  status: BulkUploadMatchStatus;
  /** DUPLICATE: the other files that claimed the same entry (issue #201). */
  conflictsWith?: string[];
  /** IGNORED: a system file ("._jem001.chordpro", ".DS_Store"), or not the kind being uploaded. */
  ignoredBecause?: "hidden" | "type";
}

/** The most files one bulk upload request takes (held in the API's memory until stored); the web app sends more in batches (issue #202). */
export const BULK_UPLOAD_MAX_FILES_PER_REQUEST = 200;

/** The kinds of file a bulk upload takes, by extension (issue #201): another kind is left out rather than matched. */
export const BULK_UPLOAD_EXTENSIONS = {
  CHORDPRO: CHART_FILE_EXTENSIONS,
  PDF: [".pdf"],
} as const;

/**
 * Files no one means to upload: macOS's "._name" copies (written beside
 * every file on a USB stick, a network drive or in a zip) and other dot
 * files, Windows' Thumbs.db and desktop.ini.
 */
export function isSystemFile(filename: string): boolean {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.startsWith(".") || /^(thumbs\.db|desktop\.ini)$/i.test(base);
}

/** The first run of digits in the filename, ignoring the extension. */
export function extractNumericToken(filename: string): string | null {
  const base = filename.replace(/\.[^./\\]+$/, "");
  const match = base.match(/(\d+)/);
  return match?.[1] ?? null;
}

/**
 * Two codes match if they're identical, or - since filenames are usually
 * zero-padded to match a printed edition ("0245") while a hand-entered
 * entryCode might not be ("245") - if both are purely numeric and equal
 * as numbers.
 */
function codesMatch(extractedToken: string, entryCode: string): boolean {
  if (extractedToken === entryCode) return true;
  if (!/^\d+$/.test(entryCode)) return false;
  return Number(extractedToken) === Number(entryCode);
}

/**
 * Matches each filename against the given list of real entry codes.
 * A code claimed by more than one file is reported as DUPLICATE for every
 * file that claims it - callers must resolve the conflict by hand rather
 * than guessing, per the "review step is mandatory" rule in §7.
 */
export function matchFilenamesToEntryCodes(filenames: string[], entryCodes: string[], type?: keyof typeof BULK_UPLOAD_EXTENSIONS): BulkUploadFileMatch[] {
  const extensions: readonly string[] | null = type ? BULK_UPLOAD_EXTENSIONS[type] : null;
  const perFile = filenames.map((filename) => {
    // Left out before matching (issue #201), so they never make a conflict.
    if (isSystemFile(filename)) return { filename, entryCode: null, ignoredBecause: "hidden" as const };
    if (extensions && !extensions.some((extension) => filename.toLowerCase().endsWith(extension))) return { filename, entryCode: null, ignoredBecause: "type" as const };
    const token = extractNumericToken(filename);
    const entryCode = token ? (entryCodes.find((code) => codesMatch(token, code)) ?? null) : null;
    return { filename, entryCode, ignoredBecause: undefined };
  });

  const claims = new Map<string, string[]>();
  for (const { filename, entryCode } of perFile) {
    if (entryCode) claims.set(entryCode, [...(claims.get(entryCode) ?? []), filename]);
  }

  return perFile.map(({ filename, entryCode, ignoredBecause }): BulkUploadFileMatch => {
    if (ignoredBecause) return { filename, entryCode: null, status: "IGNORED", ignoredBecause };
    if (!entryCode) return { filename, entryCode, status: "UNMATCHED" };
    const others = (claims.get(entryCode) ?? []).filter((other) => other !== filename);
    return others.length > 0 || (claims.get(entryCode)?.length ?? 0) > 1
      ? { filename, entryCode, status: "DUPLICATE", conflictsWith: others.length ? others : [filename] }
      : { filename, entryCode, status: "MATCHED" };
  });
}
