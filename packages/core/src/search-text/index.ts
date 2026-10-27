/**
 * Text as search compares it (issue #59): lower case, without accents, and
 * with the ligatures spelled out - "Cœur" is "coeur", "Ægir" "aegir",
 * "Straße" "strasse" - as the database's unaccent() folds songs and
 * credits (#56). Everything matched in the browser, offline or in the API
 * outside the database uses this, so all searches agree.
 */
const LIGATURES: Record<string, string> = { œ: "oe", Œ: "oe", æ: "ae", Æ: "ae", ß: "ss", ẞ: "ss", ĳ: "ij", Ĳ: "ij", ﬁ: "fi", ﬂ: "fl" };

export function foldForSearch(text: string): string {
  return text
    .replace(/[œŒæÆßẞĳĲﬁﬂ]/g, (letter) => LIGATURES[letter] ?? letter)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Apostrophes, left out of a search's words: "I've" is "ive", "l'Éternel" "leternel". */
const APOSTROPHES = /['’‘ʼ`´]/gu;
/**
 * Punctuation, hyphens and spaces between a search's words, each run one
 * space. The database's search_fold() uses the same characters.
 */
const BETWEEN_WORDS = /[\s!"#$%&()*+,./:;<=>?@[\\\]^_{|}~«»“”„‟‹›¡¿…‐‑‒–—―·•-]+/gu;

/**
 * Text as the library's search compares it (issue #328): as foldForSearch(),
 * apostrophes left out and punctuation a space, so "Éternel ! Fais-moi"
 * is "eternel fais moi" and "Saint, saint" "saint saint". The songs'
 * searchText is folded so by the database (search_fold()), and so is the
 * query; offline search folds both with this.
 */
export function foldSearchWords(text: string): string {
  return foldForSearch(text).replace(APOSTROPHES, "").replace(BETWEEN_WORDS, " ").trim();
}
