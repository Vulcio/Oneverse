import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { loadLocale, supportedLocale } from "@oneverse/app/i18n";

// TanStack Start's own client entry, plus one step: the page's messages are
// loaded before hydrating (only the reader's language is downloaded, as its
// own chunk), so the first render matches the server's HTML. The language is
// the one the server rendered in: <html lang>, set in __root.tsx.
void loadLocale(supportedLocale(document.documentElement.lang)).finally(() => {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>,
    );
  });
});
