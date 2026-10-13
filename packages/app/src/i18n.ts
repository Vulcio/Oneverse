import i18next, { type i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type LocaleValue, type Messages } from "@songverse/core";

// Each language is its own chunk, so a reader downloads only theirs.
const LOADERS: Record<LocaleValue, () => Promise<{ default: Messages }>> = {
  en: () => import("@songverse/core/i18n/locales/en"),
  fr: () => import("@songverse/core/i18n/locales/fr"),
};
const loaded = new Map<LocaleValue, Messages>();

/** `value` if it's a language we have, the default otherwise. */
export function supportedLocale(value: string | null | undefined): LocaleValue {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value ?? "") ? (value as LocaleValue) : DEFAULT_LOCALE;
}

/**
 * Loads a language's messages (once). Every route awaits it in `beforeLoad`
 * for the locale it renders in, and the client entry (src/client.tsx)
 * before hydrating, so createI18n() always finds them.
 */
export async function loadLocale(locale: LocaleValue): Promise<LocaleValue> {
  if (!loaded.has(locale)) loaded.set(locale, (await LOADERS[locale]()).default);
  return locale;
}

/**
 * Creates a fresh i18next instance for the given locale, whose messages must
 * already be loaded (see loadLocale). Deliberately not a module-level
 * singleton: this app is server-rendered, and a shared instance mutated
 * per-request (via changeLanguage) would leak one request's language into
 * another's concurrent render.
 */
export function createI18n(locale: LocaleValue): i18n {
  const messages = loaded.get(locale);
  if (!messages) throw new Error(`Messages for "${locale}" weren't loaded before rendering`);
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources: { [locale]: { translation: messages } },
    lng: locale,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    // Loaded synchronously above: render with them straight away.
    initAsync: false,
  });
  return instance;
}

/** A message by its path ("common.loading") in the page's language, outside React (the API client's, issue #113); on the server, undefined. */
export function pageMessage(path: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  let value: unknown = loaded.get(supportedLocale(document.documentElement.lang)) ?? loaded.get(DEFAULT_LOCALE);
  for (const part of path.split(".")) value = (value as Record<string, unknown> | undefined)?.[part];
  return typeof value === "string" ? value : undefined;
}
