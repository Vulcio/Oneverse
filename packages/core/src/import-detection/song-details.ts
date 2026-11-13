import { LABEL_LINE } from "../chordpro/section-labels.js";
import { isChordLine } from "../chords-over-lyrics/parser.js";
import { lrcToText } from "./lrc.js";

/**
 * A song's details as a file gives them (issue #438): ChordPro's
 * directives ("{title: …}", "{artist: …}", "{tempo: 72}"), the tags of an
 * LRC file, or the lines a plain text file starts with ("Amazing Grace
 * chords by Chris Tomlin", "Capo 2", "Key: G", "Tempo: 72"). Only what the
 * file says; the song's own fields are filled from it where they're empty.
 */
export interface SongFileDetails {
  title?: string;
  subtitle?: string;
  artists: string[];
  composers: string[];
  lyricists: string[];
  /** Words and music. */
  writers: string[];
  album?: string;
  year?: number;
  key?: string;
  tempo?: number;
  /** "3/4". */
  timeSignature?: string;
  capo?: number;
  ccli?: string;
  copyright?: string;
  durationSeconds?: number;
}

/** The extensions of the chart files a song is made from (besides PDFs): ChordPro's, OnSong's, plain text, LRC. */
export const CHART_FILE_EXTENSIONS = [".cho", ".chordpro", ".chopro", ".crd", ".pro", ".chord", ".onsong", ".txt", ".text", ".tab", ".lrc"] as const;

export const emptyDetails = (): SongFileDetails => ({ artists: [], composers: [], lyricists: [], writers: [] });

const DIRECTIVE = /^\s*\{\s*([a-z_]+)\s*:\s*(.*?)\s*\}\s*$/i;
const META = /^(\S+)\s+(.+)$/;
const KEY = /^[A-G](?:#|b|♯|♭)?\s*(?:m|min|minor|maj|major|mineur|majeur)?$/i;

/** Where each named detail goes, by its ChordPro name (and its "{meta: name value}" form). */
function setDetail(details: SongFileDetails, name: string, raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  switch (name.toLowerCase()) {
    case "title":
    case "t":
      details.title ??= value;
      return true;
    case "subtitle":
    case "st":
    case "alttitle":
      details.subtitle ??= value;
      return true;
    case "artist":
    case "artiste":
      details.artists.push(...names(value));
      return true;
    case "composer":
      details.composers.push(...names(value));
      return true;
    case "lyricist":
      details.lyricists.push(...names(value));
      return true;
    case "author":
    case "writer":
    case "words_and_music":
      details.writers.push(...names(value));
      return true;
    case "album":
      details.album ??= value;
      return true;
    case "year": {
      const year = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(value);
      if (year) details.year ??= Number(year[1]);
      return Boolean(year);
    }
    case "key": {
      const key = readKey(value);
      if (key) details.key ??= key;
      return Boolean(key);
    }
    case "tempo":
    case "bpm": {
      const tempo = /(\d{2,3}(?:[.,]\d+)?)/.exec(value);
      const bpm = tempo ? Number(tempo[1]!.replace(",", ".")) : NaN;
      if (bpm >= 20 && bpm <= 400) details.tempo ??= Math.round(bpm);
      return Boolean(tempo);
    }
    case "time": {
      const time = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(value);
      if (time) details.timeSignature ??= `${time[1]}/${time[2]}`;
      return Boolean(time);
    }
    case "capo": {
      const capo = /(\d{1,2})/.exec(value);
      if (capo && Number(capo[1]) > 0 && Number(capo[1]) <= 12) details.capo ??= Number(capo[1]);
      return Boolean(capo);
    }
    case "ccli": {
      const ccli = /(\d{3,9})/.exec(value);
      if (ccli) details.ccli ??= ccli[1];
      return Boolean(ccli);
    }
    case "copyright":
      details.copyright ??= value;
      return true;
    case "duration": {
      const duration = /^(?:(\d{1,3}):)?(\d{1,2})(?::(\d{2}))?$/.exec(value);
      if (!duration) return false;
      const parts = [duration[1], duration[2], duration[3]].filter((part) => part !== undefined).map(Number);
      details.durationSeconds ??= parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts.length === 2 ? parts[0]! * 60 + parts[1]! : parts[0]!;
      return true;
    }
    default:
      return false;
  }
}

/** "A, B & C", "A and B", "A; B": each name. */
function names(value: string): string[] {
  return value
    .split(/\s*(?:[,;/&]|\band\b|\bet\b|\by\b|\bund\b)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
}

/** "G", "Em", "F# minor", "Bb major" as the key's short name ("F#m", "Bb"); null when it isn't one. */
function readKey(value: string): string | null {
  const text = value.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  if (!KEY.test(text)) return null;
  const root = text.slice(0, /^[A-G][#b]/i.test(text) ? 2 : 1);
  const minor = /(m|min|minor|mineur)$/i.test(text.slice(root.length).trim()) && !/maj|major|majeur/i.test(text);
  return root[0]!.toUpperCase() + root.slice(1) + (minor ? "m" : "");
}

// The lines a plain text file starts with, as chord sites and other apps write them.
const PLAIN: [RegExp, string][] = [
  [/^(?:title|titre|t[ií]tulo|titel)\s*:\s*(.+)$/i, "title"],
  [/^(?:artist|artiste|artista|interpr[eè]te|performed by)\s*:?\s*(.+)$/i, "artist"],
  [/^(?:words and music|words & music|paroles et musique|written)\s*(?:by|:|de)\s*:?\s*(.+)$/i, "writer"],
  [/^(?:words|lyrics|paroles|letra|text)\s*(?:by|:|de)\s*:?\s*(.+)$/i, "lyricist"],
  [/^(?:music|musique|m[uú]sica|melodie|melody|tune)\s*(?:by|:|de)\s*:?\s*(.+)$/i, "composer"],
  [/^(?:key|tonalit[ée]|tonalidad|tom|tonart|ton)\s*:\s*(.+)$/i, "key"],
  [/^capo\s*(?::|on|sur)?\s*(\d{1,2})(?:st|nd|rd|th|e|ème)?(?:\s*(?:fret|case))?$/i, "capo"],
  [/^(?:tempo|bpm)\s*[:=]?\s*(\d{2,3}(?:[.,]\d+)?)\s*(?:bpm)?$/i, "tempo"],
  [/^(\d{2,3})\s*bpm$/i, "tempo"],
  [/^(?:time|time signature|signature|mesure|meter|metre|comp[aá]s)\s*:\s*(\d{1,2}\s*\/\s*\d{1,2})$/i, "time"],
  [/^ccli(?:\s*song)?\s*(?:#|no\.?|number|n°)?\s*:?\s*(\d{3,9})$/i, "ccli"],
  [/^((?:©|\(c\)\s|copyright\b).+)$/i, "copyright"],
  [/^(?:album)\s*:\s*(.+)$/i, "album"],
  [/^(?:year|ann[ée]e|a[ñn]o)\s*:\s*(\d{4})$/i, "year"],
];
// "Amazing Grace chords by Chris Tomlin" (the first line a chord site's page is copied with), "… Chords - Hillsong".
const CHORDS_BY = /^(.+?)\s+(?:chords|tab|tabs|lyrics|ukulele chords|accords|acordes)\s+(?:by|-|–|de|par|von)\s+(.+)$/i;

/** One of a plain file's first lines read as a detail ("Key: G", "Capo 2"…); false when it isn't one. */
export function plainDetail(details: SongFileDetails, line: string): boolean {
  for (const [pattern, name] of PLAIN) {
    const match = pattern.exec(line);
    if (match) return setDetail(details, name === "time" ? "time" : name, match[1]!.replace(/\s+/g, name === "time" ? "" : " "));
  }
  return false;
}

/**
 * The details a song file gives, and its text without the lines it gave
 * them in (a plain file's first lines; ChordPro's directives are left for
 * the chart to skip, and its "{key}" to be read where the key changes).
 * An LRC file comes back as its words.
 */
export function readSongFile(text: string): { details: SongFileDetails; body: string } {
  const details = emptyDetails();
  const lrc = lrcToText(text);
  if (lrc) {
    const { title, artist, album, writer, durationSeconds } = lrc.details;
    if (title) details.title = title;
    if (artist) details.artists.push(...names(artist));
    if (album) details.album = album;
    if (writer) details.writers.push(...names(writer));
    if (durationSeconds) details.durationSeconds = durationSeconds;
    return { details, body: lrc.text };
  }

  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  let directives = false;
  for (const line of lines) {
    const directive = DIRECTIVE.exec(line);
    if (!directive) continue;
    directives = true;
    const name = directive[1]!.toLowerCase();
    if (name === "meta") {
      const meta = META.exec(directive[2]!.trim());
      if (meta) setDetail(details, meta[1]!, meta[2]!);
    } else setDetail(details, name, directive[2]!);
  }
  if (directives) return { details, body: text };

  // A plain file: its first lines, up to the first blank line or heading, when they're all details -
  // or details with at most a title and an artist written alone.
  const header: number[] = [];
  const untagged: string[] = [];
  const found = emptyDetails();
  let index = 0;
  while (index < lines.length && lines[index]!.trim() === "") index++;
  let ended = false;
  for (; index < lines.length && header.length < 10; index++) {
    const line = lines[index]!.trim();
    if (line === "" || LABEL_LINE.test(line) || line.startsWith("{")) {
      ended = true;
      break;
    }
    if (isChordLine(line)) break;
    const chordsBy = header.length === 0 ? CHORDS_BY.exec(line) : null;
    if (chordsBy) {
      found.title = chordsBy[1]!.trim();
      found.artists.push(...names(chordsBy[2]!));
    } else if (!plainDetail(found, line)) {
      untagged.push(line);
      if (untagged.length > 2) return { details, body: text };
    }
    header.push(index);
  }
  const tagged = header.length - untagged.length;
  // Lines alone are a title and an artist only beside other details (OnSong's "Title / Artist / Key: G").
  if (!ended || header.length === 0 || (untagged.length > 0 && tagged === 0)) return { details, body: text };
  if (untagged[0]) found.title ??= untagged[0];
  if (untagged[1]) found.artists.unshift(...names(untagged[1]));
  const skip = new Set(header);
  return { details: found, body: lines.filter((_, i) => !skip.has(i)).join("\n") };
}

/** The file's name as a title: "amazing_grace-v2.cho" → "Amazing grace v2". */
export function titleFromFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,8}$/i, "");
  const spaced = base.replace(/[_]+/g, " ").replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").trim();
  if (!spaced) return "";
  return spaced === spaced.toLowerCase() ? spaced[0]!.toUpperCase() + spaced.slice(1) : spaced;
}
