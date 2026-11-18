/**
 * The books of the Bible (issue #301): their numbers - the ones Zefania and
 * Beblia files use, 1-66 for the Protestant canon and Zefania's from 67 for
 * the deuterocanonical books - their OSIS ids, and what people call them in
 * English and French, for reading a reference and naming a book a file
 * doesn't name.
 */
import { foldForSearch } from "../search-text/index.js";

export type BibleBookLocale = "en" | "fr";

export interface BibleBookInfo {
  number: number;
  osisId: string;
  /** A book with a single chapter: "Jude 3" is its verse 3. */
  oneChapter?: true;
  names: Record<BibleBookLocale, string>;
  /** Other names and abbreviations people write, in either language. */
  aliases: string[];
}

const book = (number: number, osisId: string, en: string, fr: string, aliases: string[], oneChapter?: true): BibleBookInfo => ({
  number,
  osisId,
  names: { en, fr },
  aliases,
  ...(oneChapter ? { oneChapter } : {}),
});

export const BIBLE_BOOKS: readonly BibleBookInfo[] = [
  book(1, "Gen", "Genesis", "Genèse", ["Gen", "Ge", "Gn"]),
  book(2, "Exod", "Exodus", "Exode", ["Exod", "Exo", "Ex"]),
  book(3, "Lev", "Leviticus", "Lévitique", ["Lev", "Le", "Lv"]),
  book(4, "Num", "Numbers", "Nombres", ["Num", "Nu", "Nm", "Nb"]),
  book(5, "Deut", "Deuteronomy", "Deutéronome", ["Deut", "Deu", "Dt"]),
  book(6, "Josh", "Joshua", "Josué", ["Josh", "Jos", "Jsh"]),
  book(7, "Judg", "Judges", "Juges", ["Judg", "Jdg", "Jg"]),
  book(8, "Ruth", "Ruth", "Ruth", ["Rth", "Ru", "Rt"]),
  book(9, "1Sam", "1 Samuel", "1 Samuel", ["1 Sam", "1 Sa", "1 Sm", "1 S"]),
  book(10, "2Sam", "2 Samuel", "2 Samuel", ["2 Sam", "2 Sa", "2 Sm", "2 S"]),
  book(11, "1Kgs", "1 Kings", "1 Rois", ["1 Kgs", "1 Ki", "1 Kg", "1 R"]),
  book(12, "2Kgs", "2 Kings", "2 Rois", ["2 Kgs", "2 Ki", "2 Kg", "2 R"]),
  book(13, "1Chr", "1 Chronicles", "1 Chroniques", ["1 Chr", "1 Ch", "1 Chron"]),
  book(14, "2Chr", "2 Chronicles", "2 Chroniques", ["2 Chr", "2 Ch", "2 Chron"]),
  book(15, "Ezra", "Ezra", "Esdras", ["Ezr", "Esd"]),
  book(16, "Neh", "Nehemiah", "Néhémie", ["Neh", "Ne", "Né"]),
  book(17, "Esth", "Esther", "Esther", ["Esth", "Est"]),
  book(18, "Job", "Job", "Job", ["Jb"]),
  book(19, "Ps", "Psalms", "Psaumes", ["Psalm", "Psaume", "Ps", "Psa", "Pss"]),
  book(20, "Prov", "Proverbs", "Proverbes", ["Prov", "Pro", "Prv", "Pr"]),
  book(21, "Eccl", "Ecclesiastes", "Ecclésiaste", ["Eccl", "Ecc", "Ec", "Qoh", "Qohelet", "Qohéleth"]),
  book(22, "Song", "Song of Songs", "Cantique des cantiques", ["Song of Solomon", "Song", "SoS", "Cant", "Canticles", "Cantique", "Ct"]),
  book(23, "Isa", "Isaiah", "Ésaïe", ["Isa", "Is", "Isaïe", "Es"]),
  book(24, "Jer", "Jeremiah", "Jérémie", ["Jer", "Je", "Jr"]),
  book(25, "Lam", "Lamentations", "Lamentations", ["Lam", "La", "Lm"]),
  book(26, "Ezek", "Ezekiel", "Ézéchiel", ["Ezek", "Eze", "Ezk", "Ez"]),
  book(27, "Dan", "Daniel", "Daniel", ["Dan", "Da", "Dn"]),
  book(28, "Hos", "Hosea", "Osée", ["Hos", "Ho", "Os"]),
  book(29, "Joel", "Joel", "Joël", ["Jl"]),
  book(30, "Amos", "Amos", "Amos", ["Am"]),
  book(31, "Obad", "Obadiah", "Abdias", ["Obad", "Ob", "Ab"], true),
  book(32, "Jonah", "Jonah", "Jonas", ["Jon", "Jnh"]),
  book(33, "Mic", "Micah", "Michée", ["Mic", "Mi"]),
  book(34, "Nah", "Nahum", "Nahum", ["Nah", "Na"]),
  book(35, "Hab", "Habakkuk", "Habacuc", ["Hab", "Ha"]),
  book(36, "Zeph", "Zephaniah", "Sophonie", ["Zeph", "Zep", "Zp", "So"]),
  book(37, "Hag", "Haggai", "Aggée", ["Hag", "Hg", "Ag"]),
  book(38, "Zech", "Zechariah", "Zacharie", ["Zech", "Zec", "Zc", "Za"]),
  book(39, "Mal", "Malachi", "Malachie", ["Mal", "Ml"]),
  book(40, "Matt", "Matthew", "Matthieu", ["Matt", "Mat", "Mt"]),
  book(41, "Mark", "Mark", "Marc", ["Mrk", "Mk", "Mc"]),
  book(42, "Luke", "Luke", "Luc", ["Luk", "Lk", "Lc"]),
  book(43, "John", "John", "Jean", ["Jhn", "Jn"]),
  book(44, "Acts", "Acts", "Actes", ["Act", "Ac"]),
  book(45, "Rom", "Romans", "Romains", ["Rom", "Ro", "Rm"]),
  book(46, "1Cor", "1 Corinthians", "1 Corinthiens", ["1 Cor", "1 Co"]),
  book(47, "2Cor", "2 Corinthians", "2 Corinthiens", ["2 Cor", "2 Co"]),
  book(48, "Gal", "Galatians", "Galates", ["Gal", "Ga"]),
  book(49, "Eph", "Ephesians", "Éphésiens", ["Eph", "Ép"]),
  book(50, "Phil", "Philippians", "Philippiens", ["Phil", "Php", "Ph"]),
  book(51, "Col", "Colossians", "Colossiens", ["Col"]),
  book(52, "1Thess", "1 Thessalonians", "1 Thessaloniciens", ["1 Thess", "1 Thes", "1 Th"]),
  book(53, "2Thess", "2 Thessalonians", "2 Thessaloniciens", ["2 Thess", "2 Thes", "2 Th"]),
  book(54, "1Tim", "1 Timothy", "1 Timothée", ["1 Tim", "1 Ti", "1 Tm"]),
  book(55, "2Tim", "2 Timothy", "2 Timothée", ["2 Tim", "2 Ti", "2 Tm"]),
  book(56, "Titus", "Titus", "Tite", ["Tit", "Tt"]),
  book(57, "Phlm", "Philemon", "Philémon", ["Phlm", "Phm", "Philem"], true),
  book(58, "Heb", "Hebrews", "Hébreux", ["Heb", "Hé"]),
  book(59, "Jas", "James", "Jacques", ["Jas", "Jm", "Jc"]),
  book(60, "1Pet", "1 Peter", "1 Pierre", ["1 Pet", "1 Pe", "1 Pt", "1 P"]),
  book(61, "2Pet", "2 Peter", "2 Pierre", ["2 Pet", "2 Pe", "2 Pt", "2 P"]),
  book(62, "1John", "1 John", "1 Jean", ["1 Jn", "1 Jhn", "1 Jo"]),
  book(63, "2John", "2 John", "2 Jean", ["2 Jn", "2 Jhn", "2 Jo"], true),
  book(64, "3John", "3 John", "3 Jean", ["3 Jn", "3 Jhn", "3 Jo"], true),
  book(65, "Jude", "Jude", "Jude", ["Jud", "Jd"], true),
  book(66, "Rev", "Revelation", "Apocalypse", ["Revelations", "Rev", "Re", "Rv", "Ap", "Apoc"]),
  book(67, "Jdt", "Judith", "Judith", ["Jdt", "Jdth"]),
  book(68, "Wis", "Wisdom", "Sagesse", ["Wisdom of Solomon", "Wis", "Sg", "Sag"]),
  book(69, "Tob", "Tobit", "Tobie", ["Tob", "Tb"]),
  book(70, "Sir", "Sirach", "Siracide", ["Ecclesiasticus", "Ecclésiastique", "Sir", "Si"]),
  book(71, "Bar", "Baruch", "Baruch", ["Bar", "Ba"]),
  book(72, "1Macc", "1 Maccabees", "1 Maccabées", ["1 Macc", "1 Mac", "1 Ma", "1 M"]),
  book(73, "2Macc", "2 Maccabees", "2 Maccabées", ["2 Macc", "2 Mac", "2 Ma", "2 M"]),
];

const BY_NUMBER = new Map(BIBLE_BOOKS.map((info) => [info.number, info]));
const BY_OSIS = new Map(BIBLE_BOOKS.map((info) => [info.osisId.toLowerCase(), info]));

/**
 * A book's name as a key: case, accents, spaces and dots ignored, and a
 * leading Roman numeral or ordinal read as its number ("I John", "First
 * John", "1er Jean" are "1john").
 */
export function bookKey(name: string): string {
  const folded = foldForSearch(name).trim().replace(/\.+/g, " ").replace(/\s+/g, " ");
  const numbered = folded
    .replace(/^(iii|3e|3rd|third|troisieme)\s+/, "3")
    .replace(/^(ii|2e|2nd|second|deuxieme)\s+/, "2")
    .replace(/^(i|1er|1re|1st|first|premier|premiere)\s+/, "1");
  return numbered.replace(/\s+/g, "");
}

const BY_KEY = new Map<string, BibleBookInfo>();
for (const info of BIBLE_BOOKS) {
  for (const name of [info.names.en, info.names.fr, info.osisId, ...info.aliases]) {
    const key = bookKey(name);
    if (!BY_KEY.has(key)) BY_KEY.set(key, info);
  }
}
const FULL_NAMES = BIBLE_BOOKS.flatMap((info) => [info.names.en, info.names.fr, ...info.aliases.filter((alias) => alias.length > 4)].map((name) => ({ key: bookKey(name), info })));

/** A book by its number; undefined for one this list doesn't know. */
export function bibleBook(number: number): BibleBookInfo | undefined {
  return BY_NUMBER.get(number);
}

/** A book by its OSIS id ("Gen", "1John"), case ignored. */
export function bibleBookByOsisId(osisId: string): BibleBookInfo | undefined {
  return BY_OSIS.get(osisId.toLowerCase());
}

/**
 * The book someone means by `name`: a name or an abbreviation in English or
 * French, its OSIS id, or the start of one name only, three letters at least
 * ("Philipp", "Apoc"). Undefined when none, or when the start fits several.
 */
export function findBibleBook(name: string, own?: BookNames): BibleBookInfo | undefined {
  const key = bookKey(name);
  if (!key) return undefined;
  if (own?.length) {
    // The version's own names first (issue #507): "Juan" is John in a Spanish Bible.
    const mine = own.filter((one) => one.names.some((other) => bookKey(other) === key));
    if (mine.length === 1 && BY_NUMBER.has(mine[0]!.number)) return BY_NUMBER.get(mine[0]!.number);
  }
  const exact = BY_KEY.get(key);
  if (exact) return exact;
  if (key.replace(/^\d/, "").length < 3) return undefined;
  const found = new Set(FULL_NAMES.filter((entry) => entry.key.startsWith(key)).map((entry) => entry.info));
  if (found.size === 1) return [...found][0];
  if (found.size === 0 && own?.length) {
    const started = new Set(own.filter((one) => one.names.some((other) => bookKey(other).startsWith(key))).map((one) => one.number));
    if (started.size === 1) return BY_NUMBER.get([...started][0]!);
  }
  return undefined;
}

/**
 * A version's own names for its books (issue #507), by number: YouVersion's
 * titles and abbreviations ("Juan", "Jn"), an imported Bible's names - so a
 * reference written in the version's language is read for that version.
 */
export type BookNames = readonly { number: number; names: readonly string[] }[];

/** A book's name in `locale`, or `fallback` (a file's own name) for a book this list doesn't know. */
export function bibleBookName(number: number, locale: BibleBookLocale, fallback?: string): string {
  return BY_NUMBER.get(number)?.names[locale] ?? fallback ?? String(number);
}

/** How many chapters each book has, by its number (1-66, then 67-73), as most Bibles divide them. */
const CHAPTERS = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4,
  28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
  16, 19, 14, 51, 6, 16, 15,
];

/** A book's chapters, as most Bibles divide them (issue #310): for picking one where a Bible doesn't say. Undefined for a book this list doesn't know. */
export function bibleBookChapters(number: number): number | undefined {
  return CHAPTERS[number - 1];
}

/**
 * How many verses each chapter has (issue #507), book by book (1-66), as
 * English Bibles number them (the KJV's 31,102 verses): for picking verses
 * without asking anyone. Some traditions number a few places differently
 * (a psalm's title as its verse 1, Malachi 4 as Malachi 3:19-24); a
 * version's own list says so when it has one.
 */
const VERSES: readonly string[] = [
  "31 25 24 26 32 22 24 22 29 32 32 20 18 24 21 16 27 33 38 18 34 24 20 67 34 35 46 22 35 43 55 32 20 31 29 43 36 30 23 23 57 38 34 34 28 34 31 22 33 26",
  "22 25 22 31 23 30 25 32 35 29 10 51 22 31 27 36 16 27 25 26 36 31 33 18 40 37 21 43 46 38 18 35 23 35 35 38 29 31 43 38",
  "17 16 17 35 19 30 38 36 24 20 47 8 59 57 33 34 16 30 37 27 24 33 44 23 55 46 34",
  "54 34 51 49 31 27 89 26 23 36 35 16 33 45 41 50 13 32 22 29 35 41 30 25 18 65 23 31 40 16 54 42 56 29 34 13",
  "46 37 29 49 33 25 26 20 29 22 32 32 18 29 23 22 20 22 21 20 23 30 25 22 19 19 26 68 29 20 30 52 29 12",
  "18 24 17 24 15 27 26 35 27 43 23 24 33 15 63 10 18 28 51 9 45 34 16 33",
  "36 23 31 24 31 40 25 35 57 18 40 15 25 20 20 31 13 31 30 48 25",
  "22 23 18 22",
  "28 36 21 22 12 21 17 22 27 27 15 25 23 52 35 23 58 30 24 42 15 23 29 22 44 25 12 25 11 31 13",
  "27 32 39 12 25 23 29 18 13 19 27 31 39 33 37 23 29 33 43 26 22 51 39 25",
  "53 46 28 34 18 38 51 66 28 29 43 33 34 31 34 34 24 46 21 43 29 53",
  "18 25 27 44 27 33 20 29 37 36 21 21 25 29 38 20 41 37 37 21 26 20 37 20 30",
  "54 55 24 43 26 81 40 40 44 14 47 40 14 17 29 43 27 17 19 8 30 19 32 31 31 32 34 21 30",
  "17 18 17 22 14 42 22 18 31 19 23 16 22 15 19 14 19 34 11 37 20 12 21 27 28 23 9 27 36 27 21 33 25 33 27 23",
  "11 70 13 24 17 22 28 36 15 44",
  "11 20 32 23 19 19 73 18 38 39 36 47 31",
  "22 23 15 17 14 14 10 17 32 3",
  "22 13 26 21 27 30 21 22 35 22 20 25 28 22 35 22 16 21 29 29 34 30 17 25 6 14 23 28 25 31 40 22 33 37 16 33 24 41 30 24 34 17",
  "6 12 8 8 12 10 17 9 20 18 7 8 6 7 5 11 15 50 14 9 13 31 6 10 22 12 14 9 11 12 24 11 22 22 28 12 40 22 13 17 13 11 5 26 17 11 9 14 20 23 19 9 6 7 23 13 11 11 17 12 8 12 11 10 13 20 7 35 36 5 24 20 28 23 10 12 20 72 13 19 16 8 18 12 13 17 7 18 52 17 16 15 5 23 11 13 12 9 9 5 8 28 22 35 45 48 43 13 31 7 10 10 9 8 18 19 2 29 176 7 8 9 4 8 5 6 5 6 8 8 3 18 3 3 21 26 9 8 24 13 10 7 12 15 21 10 20 14 9 6",
  "33 22 35 27 23 35 27 36 18 32 31 28 25 35 33 33 28 24 29 30 31 29 35 34 28 28 27 28 27 33 31",
  "18 26 22 16 20 12 29 17 18 20 10 14",
  "17 17 11 16 16 13 13 14",
  "31 22 26 6 30 13 25 22 21 34 16 6 22 32 9 14 14 7 25 6 17 25 18 23 12 21 13 29 24 33 9 20 24 17 10 22 38 22 8 31 29 25 28 28 25 13 15 22 26 11 23 15 12 17 13 12 21 14 21 22 11 12 19 12 25 24",
  "19 37 25 31 31 30 34 22 26 25 23 17 27 22 21 21 27 23 15 18 14 30 40 10 38 24 22 17 32 24 40 44 26 22 19 32 21 28 18 16 18 22 13 30 5 28 7 47 39 46 64 34",
  "22 22 66 22 22",
  "28 10 27 17 17 14 27 18 11 22 25 28 23 23 8 63 24 32 14 49 32 31 49 27 17 21 36 26 21 26 18 32 33 31 15 38 28 23 29 49 26 20 27 31 25 24 23 35",
  "21 49 30 37 31 28 28 27 27 21 45 13",
  "11 23 5 19 15 11 16 14 17 15 12 14 16 9",
  "20 32 21",
  "15 16 15 13 27 14 17 14 15",
  "21",
  "17 10 10 11",
  "16 13 12 13 15 16 20",
  "15 13 19",
  "17 20 19",
  "18 15 20",
  "15 23",
  "21 13 10 14 11 15 14 23 17 12 17 14 9 21",
  "14 17 18 6",
  "25 23 17 25 48 34 29 34 38 42 30 50 58 36 39 28 27 35 30 34 46 46 39 51 46 75 66 20",
  "45 28 35 41 43 56 37 38 50 52 33 44 37 72 47 20",
  "80 52 38 44 39 49 50 56 62 42 54 59 35 35 32 31 37 43 48 47 38 71 56 53",
  "51 25 36 54 47 71 53 59 41 42 57 50 38 31 27 33 26 40 42 31 25",
  "26 47 26 37 42 15 60 40 43 48 30 25 52 28 41 40 34 28 41 38 40 30 35 27 27 32 44 31",
  "32 29 31 25 21 23 25 39 33 21 36 21 14 23 33 27",
  "31 16 23 21 13 20 40 13 27 33 34 31 13 40 58 24",
  "24 17 18 18 21 18 16 24 15 18 33 21 14",
  "24 21 29 31 26 18",
  "23 22 21 32 33 24",
  "30 30 21 23",
  "29 23 25 18",
  "10 20 13 18 28",
  "12 17 18",
  "20 15 16 16 25 21",
  "18 26 17 22",
  "16 15 15",
  "25",
  "14 18 19 16 14 20 28 13 28 39 40 29 25",
  "27 26 18 17 20",
  "25 25 22 19 14",
  "21 22 18",
  "10 29 24 21 21",
  "13",
  "14",
  "25",
  "20 29 22 11 14 17 17 13 21 11 19 17 18 20 8 21 18 24 21 15 27 21",
];

/** The verses of each of a book's chapters (index 0: chapter 1), as English Bibles number them; undefined for a book outside 1-66. */
export function bibleBookVerses(number: number): number[] | undefined {
  return VERSES[number - 1]?.split(" ").map(Number);
}

/** Which part of the Bible a book is in, by its number: the Old Testament, the New, or the deuterocanonical books. */
export function bibleTestament(number: number): "old" | "new" | "deuterocanon" {
  return number <= 39 ? "old" : number <= 66 ? "new" : "deuterocanon";
}
