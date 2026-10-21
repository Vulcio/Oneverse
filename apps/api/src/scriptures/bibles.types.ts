/** Bibles imported from files, converted on the Worker (issue #301). */
export const SCRIPTURES_QUEUE = "scriptures";

export interface BibleImportJobData {
  bibleId: string;
}

/** A book as an imported Bible names it, kept on the Bible's row. */
export interface ImportedBibleBook {
  number: number;
  name: string;
  osisId?: string;
  chapters: number;
}
