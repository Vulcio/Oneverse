import { HeadContent, Scripts, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { renderPublicEnvScript } from "../public-env";

/** What every app's root route puts in its head: the page's name, its stylesheet and its icon. */
export function appHead({ title, css, meta = [], links = [] }: {
  title: string;
  /** The app's stylesheet (`app.css?url`). */
  css: string;
  meta?: Array<Record<string, string>>;
  links?: Array<Record<string, string>>;
}) {
  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      ...meta,
      { title },
    ],
    links: [
      { rel: "stylesheet", href: css },
      ...links,
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
    ],
  };
}

/**
 * The language the page is in: the locale the matched routes rendered with (a public page's `locale`,
 * or the signed-in person's). Also how the client entry knows which messages to load before hydrating.
 */
export function usePageLocale(): string {
  return useMatches({
    select: (matches) => {
      for (const match of [...matches].reverse()) {
        const context = match.context as { locale?: string; session?: { locale?: string } } | undefined;
        const locale = context?.locale ?? context?.session?.locale;
        if (locale) return locale;
      }
      return "en";
    },
  });
}

// For notifications on this device (push), and Songverse's offline pages.
const REGISTER_SW_SCRIPT = `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js')})}`;

/**
 * An app's whole page, the same in each (issue #427): the page's language, the public addresses the
 * browser needs, the script that sets light or dark before the page paints, the app, its scripts.
 */
export function AppDocument({ env, themeScript, serviceWorker = false, htmlClassName, bodyClassName, head, children }: {
  /** The other apps' addresses this one links to (public-env). */
  env: string[];
  /** Sets `<html>`'s theme before hydration: `THEME_SCRIPT`, or Songverse's modes. */
  themeScript?: string;
  /** Registers `/sw.js`. */
  serviceWorker?: boolean;
  htmlClassName?: string;
  bodyClassName?: string;
  /** More for the head, given the page's language (Songverse's manifest). */
  head?: (lang: string) => ReactNode;
  children: ReactNode;
}) {
  const lang = usePageLocale();
  return (
    // The theme script changes <html> before hydration, hence the warning suppressed.
    <html lang={lang} className={htmlClassName} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: renderPublicEnvScript(env) }} />
        {themeScript ? <script dangerouslySetInnerHTML={{ __html: themeScript }} /> : null}
        <HeadContent />
        {head?.(lang)}
      </head>
      <body className={bodyClassName ?? "min-h-screen bg-background text-foreground antialiased"}>
        {children}
        {serviceWorker ? <script dangerouslySetInnerHTML={{ __html: REGISTER_SW_SCRIPT }} /> : null}
        <Scripts />
      </body>
    </html>
  );
}
