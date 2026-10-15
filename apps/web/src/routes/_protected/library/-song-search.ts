import { SONG_TABS, type SongNotice, type SongTab } from "#/components/song-editor/song-tabs-list";

export interface SongSearch {
  tab?: SongTab;
  /** Comma-separated SongNotice values, from creating the song. */
  notice?: string;
  /** Adding a song: the song it's a translation or adaptation of (issue #78). */
  linkTo?: string;
  /** Opened from a songbook: the sidebar lists that songbook's songs (issue #80). */
  songbook?: string;
  /** Opened from Songs: that list's own search (favorites, a smart list, filters), for the sidebar (issue #80). */
  from?: string;
  /** Found by its words (issue #221): the line it opens at. */
  line?: string;
  /** A note's thread to open (issue #256): from a notification. */
  note?: string;
}

export function parseSongSearch(search: Record<string, unknown>): SongSearch {
  return {
    ...(typeof search.tab === "string" && (SONG_TABS as readonly string[]).includes(search.tab) && { tab: search.tab as SongTab }),
    ...(typeof search.notice === "string" && search.notice && { notice: search.notice }),
    ...(typeof search.linkTo === "string" && search.linkTo && { linkTo: search.linkTo }),
    ...(typeof search.songbook === "string" && search.songbook && { songbook: search.songbook }),
    ...(typeof search.from === "string" && search.from && { from: search.from }),
    ...(typeof search.line === "string" && search.line && { line: search.line }),
    ...(typeof search.note === "string" && search.note && { note: search.note }),
  };
}

const NOTICES: SongNotice[] = ["linkFailed", "fileFailed"];

export function parseNotices(notice: string | undefined): SongNotice[] {
  return (notice ?? "").split(",").filter((value): value is SongNotice => (NOTICES as string[]).includes(value));
}
