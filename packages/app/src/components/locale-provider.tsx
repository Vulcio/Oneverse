import type { LocaleValue } from "@songverse/core";
import { useMemo, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "../i18n";

/** Translations for pages outside the _protected layout, which has its own. */
export function LocaleProvider({ locale, children }: { locale: LocaleValue; children: ReactNode }) {
  const i18n = useMemo(() => createI18n(locale), [locale]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
