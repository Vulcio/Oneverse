import { createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MODE_SCRIPT } from "#/lib/mode";
import { AppDocument, appHead } from "@oneverse/app/components/app-document";
import appCss from "#/styles/app.css?url";

export const Route = createRootRoute({
  head: () => appHead({ title: "Songverse", css: appCss }),
  shellComponent: RootDocument,
});

/**
 * The web app manifest in the page's language (issue #404: its shortcuts' names); English for the others.
 * A new language's is public/manifest.<lang>.webmanifest, the same as the English one but its words.
 */
const MANIFESTS: Record<string, string> = { fr: "/manifest.fr.webmanifest" };

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <AppDocument
      env={["ONEVERSE_URL", "SCREEN_URL"]}
      themeScript={MODE_SCRIPT}
      serviceWorker
      bodyClassName="min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-background dark:text-foreground"
      head={(lang) => <link rel="manifest" href={MANIFESTS[lang] ?? "/manifest.webmanifest"} />}
    >
      {children}
    </AppDocument>
  );
}
