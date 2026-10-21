import { HeadContent, Scripts, createRootRoute, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MODE_SCRIPT } from "#/lib/mode";
import { renderPublicEnvScript } from "@oneverse/app/public-env";
import appCss from "#/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Songverse" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootDocument,
});

const REGISTER_SW_SCRIPT = `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js')})}`;

/**
 * The language the page is in: the locale the matched routes rendered with
 * (a public page's `locale`, or the signed-in user's). Also how the client
 * entry knows which messages to load before hydrating (src/client.tsx).
 */
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
    // The mode script sets <html>'s theme before hydration, hence the warning suppressed.
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: renderPublicEnvScript(["ONEVERSE_URL", "SCREEN_URL"]) }} />
        <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-background dark:text-foreground">
        {children}
        <script dangerouslySetInnerHTML={{ __html: REGISTER_SW_SCRIPT }} />
        <Scripts />
      </body>
    </html>
  );
}
