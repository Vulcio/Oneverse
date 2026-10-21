import { screenBuiltInTemplate } from "@oneverse/core";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { LocaleProvider } from "@oneverse/app/components/locale-provider";
import { ScreenDisplay } from "@oneverse/screen/components/screen-display";
import { loadLocale } from "@oneverse/app/i18n";
import { getVisitorLocale } from "@oneverse/app/server-auth";
import { publicEnvValue } from "@oneverse/app/public-env";
import { screenHandOff } from "@oneverse/screen/lib/screen-display";

/**
 * A big screen (issue #186): open songverse.one/screen on whatever drives
 * it - a TV's browser, a laptop on HDMI, the Google TV app (#187). No
 * sign-in: it shows a code and a QR code until someone who leads a set
 * confirms it from their phone; then it shows what's presented from Live -
 * the lyrics two lines at a time, or the chart - and goes black on demand,
 * in the look its theme gives it (issue #194). `?theme=concert` shows a
 * built-in theme instead, on this device: to try one, or for a browser
 * source in streaming software.
 *
 * Screens have their own app now (issue #305, SCREEN_URL): where it's
 * deployed, this sends the screen there, paired as it was.
 */
export const Route = createFileRoute("/screen")({
  validateSearch: (search: Record<string, unknown>): { theme?: string } =>
    typeof search.theme === "string" && screenBuiltInTemplate(search.theme) ? { theme: search.theme } : {},
  beforeLoad: async () => ({ locale: await loadLocale(await getVisitorLocale()) }),
  head: () => ({ meta: [{ title: "Songverse screen" }] }),
  component: ScreenPage,
});

function ScreenPage() {
  const { locale } = Route.useRouteContext();
  const { theme } = Route.useSearch();
  const moved = publicEnvValue("SCREEN_URL");
  useEffect(() => {
    if (moved) window.location.replace(screenHandOff(`${moved.replace(/\/$/, "")}/${theme ? `?${new URLSearchParams({ theme })}` : ""}`));
  }, [moved, theme]);
  if (moved) return <div className="min-h-screen bg-black" data-testid="screen-moving" />;
  return (
    <LocaleProvider locale={locale}>
      <ScreenDisplay pairUrl={typeof window === "undefined" ? "" : window.location.origin} pinnedTheme={theme} />
    </LocaleProvider>
  );
}
