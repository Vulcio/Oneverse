import { createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppDocument, appHead } from "@oneverse/app/components/app-document";
import appCss from "#/styles/app.css?url";

export const Route = createRootRoute({
  head: () => appHead({ title: "Oneverse screen", css: appCss, meta: [{ name: "theme-color", content: "#000000" }] }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // Songverse's address: where a screen is paired (its QR code). Dark always: a screen is black under its words.
    <AppDocument env={["SONGVERSE_URL", "ONEVERSE_URL"]} htmlClassName="dark" bodyClassName="min-h-screen bg-black text-white antialiased">
      {children}
    </AppDocument>
  );
}
