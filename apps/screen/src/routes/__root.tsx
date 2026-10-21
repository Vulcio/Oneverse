import { HeadContent, Scripts, createRootRoute, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { renderPublicEnvScript } from "@oneverse/app/public-env";
import appCss from "#/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#000000" },
      { title: "Oneverse screen" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootDocument,
});

/** The language the page is in: its route's `locale` (src/client.tsx loads it before hydrating). */
function usePageLocale(): string {
  return useMatches({
    select: (matches) => {
      for (const match of [...matches].reverse()) {
        const locale = (match.context as { locale?: string } | undefined)?.locale;
        if (locale) return locale;
      }
      return "en";
    },
  });
}

function RootDocument({ children }: { children: ReactNode }) {
  const lang = usePageLocale();
  return (
    // Dark always: a screen is black under its words.
    <html lang={lang} className="dark" suppressHydrationWarning>
      <head>
        {/* Songverse's address: where a screen is paired (its QR code). */}
        <script dangerouslySetInnerHTML={{ __html: renderPublicEnvScript(["SONGVERSE_URL", "ONEVERSE_URL"]) }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-black text-white antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
