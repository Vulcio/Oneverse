import { HeadContent, Scripts, createRootRoute, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { renderPublicEnvScript } from "@oneverse/app/public-env";
import appCss from "#/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Planiverse" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootDocument,
});

// Dark when the device is, before the page paints.
const THEME_SCRIPT = `(function(){var m=window.matchMedia('(prefers-color-scheme: dark)');function a(){document.documentElement.classList.toggle('dark',m.matches)}a();m.addEventListener('change',a)})()`;
// For notifications on this device (push): Planiverse isn't kept offline.
const REGISTER_SW_SCRIPT = `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js')})}`;

/** The language the page is in: a public page's `locale`, or the signed-in person's (src/client.tsx loads it before hydrating). */
function usePageLocale(): string {
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

function RootDocument({ children }: { children: ReactNode }) {
  const lang = usePageLocale();
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        {/* Songverse's address too: a date's set opens there. */}
        <script dangerouslySetInnerHTML={{ __html: renderPublicEnvScript(["SONGVERSE_URL", "ONEVERSE_URL"]) }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <script dangerouslySetInnerHTML={{ __html: REGISTER_SW_SCRIPT }} />
        <Scripts />
      </body>
    </html>
  );
}
