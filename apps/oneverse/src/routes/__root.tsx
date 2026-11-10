import { createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppDocument, appHead } from "@oneverse/app/components/app-document";
import { THEME_SCRIPT } from "@oneverse/app/theme";
import appCss from "#/styles/app.css?url";

export const Route = createRootRoute({
  head: () => appHead({ title: "Oneverse", css: appCss }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // The apps' addresses: where a sign-in may go back to (sign-in-continuation.ts), and their links.
    <AppDocument env={["SONGVERSE_URL", "PLANIVERSE_URL", "ONEVERSE_URL"]} themeScript={THEME_SCRIPT}>
      {children}
    </AppDocument>
  );
}
