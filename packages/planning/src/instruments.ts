import { resolveTranslation, type CustomInstrument, type LocaleValue } from "@songverse/core";
import { useTranslation } from "react-i18next";

/**
 * An instrument's name (issue #166): a built-in one's from the locale
 * files, one an admin added from its own names.
 */
export function useInstrumentLabel(custom: readonly CustomInstrument[] = []): (key: string) => string {
  const { t, i18n } = useTranslation();
  return (key) => {
    const added = custom.find((instrument) => instrument.id === key);
    return added ? resolveTranslation(added.label, added.translations, i18n.language as LocaleValue) : t(`roles.instrument.${key}`, { defaultValue: key });
  };
}
