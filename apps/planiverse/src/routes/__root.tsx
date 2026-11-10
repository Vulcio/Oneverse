import { createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppDocument, appHead } from "@oneverse/app/components/app-document";
import { THEME_SCRIPT } from "@oneverse/app/theme";
import appCss from "#/styles/app.css?url";

export const Route = createRootRoute({
  head: () => appHead({ title: "Planiverse", css: appCss, links: [{ rel: "manifest", href: "/manifest.webmanifest" }] }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // Songverse's address too: a date's set opens there. The service worker is for notifications on
    // this device (push): Planiverse isn't kept offline.
    <AppDocument env={["SONGVERSE_URL", "ONEVERSE_URL"]} themeScript={THEME_SCRIPT} serviceWorker>
      {children}
    </AppDocument>
  );
}
