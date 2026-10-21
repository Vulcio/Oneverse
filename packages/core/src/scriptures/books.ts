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
export function findBibleBook(name: string): BibleBookInfo | undefined {
  const key = bookKey(name);
  if (!key) return undefined;
  const exact = BY_KEY.get(key);
  if (exact) return exact;
  if (key.replace(/^\d/, "").length < 3) return undefined;
  const found = new Set(FULL_NAMES.filter((entry) => entry.key.startsWith(key)).map((entry) => entry.info));
  return found.size === 1 ? [...found][0] : undefined;
}

/** A book's name in `locale`, or `fallback` (a file's own name) for a book this list doesn't know. */
export function bibleBookName(number: number, locale: BibleBookLocale, fallback?: string): string {
  return BY_NUMBER.get(number)?.names[locale] ?? fallback ?? String(number);
}
