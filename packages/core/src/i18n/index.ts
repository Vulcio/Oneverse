// The messages themselves are imported one language at a time, from
// "@oneverse/core/i18n/locales/<locale>", so an app ships only the one its
// reader uses (the web app loads it before rendering; see apps/web/src/lib/i18n.ts).
import type en from "./locales/en.js";

/** A language's messages; English is the key set every language matches. */
export type Messages = typeof en;

export * from "./translate.js";
export * from "./accept-language.js";
