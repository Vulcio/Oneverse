import { HeadContent, Scripts, createRootRoute, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { renderPublicEnvScript } from "@oneverse/app/public-env";
import { THEME_SCRIPT } from "@oneverse/app/theme";
import appCss from "#/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Oneverse" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootDocument,
});

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
        {/* The apps' addresses: where a sign-in may go back to (sign-in-continuation.ts), and their links. */}
        <script dangerouslySetInnerHTML={{ __html: renderPublicEnvScript(["SONGVERSE_URL", "PLANIVERSE_URL", "ONEVERSE_URL"]) }} />
        {/* Light or dark, as picked on this device or as the device is, before the page paints (issue #422). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
