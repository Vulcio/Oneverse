import type { BibleBookLocale, ImportedBible, SetItemPassage, YouVersionBible } from "@oneverse/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { importedVersion, languageTag, pickerLanguages, youVersionVersion, type PickerVersion } from "#/components/passage-picker";
import { apiClient } from "#/lib/api-client";

/** Where the last language and version read are kept on this device. */
const LANGUAGE_KEY = "oneverse.bible.language";
const VERSION_KEY = "oneverse.bible.version";

export function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
export function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept: picked again next time.
  }
}

/** A set's passage's version, to pick it again when the passage is changed (issue #310). */
export function versionOfPassage(passage: Pick<SetItemPassage, "bibleId" | "youversionId" | "bible">, locale: BibleBookLocale): PickerVersion {
  if (passage.youversionId !== undefined) {
    return youVersionVersion({ id: passage.youversionId, abbreviation: passage.bible?.abbreviation ?? "", title: passage.bible?.name ?? `YouVersion ${passage.youversionId}`, languageTag: "", copyright: null, attribution: "", info: null, link: null }, locale);
  }
  return { key: `imported:${passage.bibleId}`, kind: "imported", id: passage.bibleId, name: passage.bible?.name ?? "", abbreviation: passage.bible?.abbreviation ?? null, books: [] };
}

/**
 * The versions to read a passage in (issue #310): the Bibles imported on the
 * server and YouVersion's, in a language - the reader's to begin with, any
 * other picked - the language and version kept on this device. `current`, a
 * set's passage's version, stays offered whatever the language.
 */
export function useBibleVersions(current?: PickerVersion | null) {
  const { i18n } = useTranslation();
  const locale: BibleBookLocale = i18n.language.startsWith("fr") ? "fr" : "en";
  const [imported, setImported] = useState<ImportedBible[] | null>(null);
  const [hasYouVersion, setHasYouVersion] = useState(false);
  const [language, setLanguageState] = useState(() => stored(LANGUAGE_KEY) || i18n.language.split("-")[0] || "en");
  const [youversion, setYouversion] = useState<YouVersionBible[]>([]);
  const [versionKey, setVersionKey] = useState(() => current?.key ?? stored(VERSION_KEY));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([apiClient.listBibles(), apiClient.getScriptureProviders().catch(() => ({ youversion: false }))]).then(
      ([bibles, providers]) => {
        setImported(bibles);
        setHasYouVersion(providers.youversion);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);
  // YouVersion's versions in the language picked.
  useEffect(() => {
    if (!hasYouVersion) return;
    let live = true;
    void apiClient
      .getYouVersionBibles(language)
      .catch(() => [])
      .then((found) => live && setYouversion(found));
    return () => {
      live = false;
    };
  }, [hasYouVersion, language]);

  const languages = useMemo(() => pickerLanguages(i18n.language, imported ?? []), [i18n.language, imported]);
  // The server's Bibles in that language (and those that don't say theirs), then YouVersion's.
  const versions = useMemo(() => {
    const listed = [
      ...(imported ?? []).filter((bible) => [language, null].includes(languageTag(bible.language))).map((bible) => importedVersion(bible, locale)),
      ...youversion.map((bible) => youVersionVersion(bible, locale)),
    ];
    // The passage's own, named as the server has it when it's listed.
    if (current && !listed.some((one) => one.key === current.key)) {
      const bible = current.kind === "imported" ? imported?.find((one) => one.id === current.id) : undefined;
      if (current.kind === "youversion" || bible) listed.unshift(bible ? importedVersion(bible, locale) : current);
    }
    return listed;
  }, [imported, youversion, language, locale, current]);
  const version = versions.find((one) => one.key === versionKey) ?? versions[0] ?? null;

  return {
    loaded: imported !== null,
    /** Nothing to read: no Bible imported, YouVersion off. */
    none: imported !== null && imported.length === 0 && !hasYouVersion,
    languages,
    language,
    setLanguage: (tag: string) => {
      setLanguageState(tag);
      store(LANGUAGE_KEY, tag);
      setYouversion([]);
    },
    versions,
    version,
    setVersion: (picked: PickerVersion) => {
      setVersionKey(picked.key);
      store(VERSION_KEY, picked.key);
    },
    error,
  };
}
