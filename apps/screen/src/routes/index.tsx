import { screenBuiltInTemplate } from "@oneverse/core";
import { createFileRoute } from "@tanstack/react-router";
import { LocaleProvider } from "@oneverse/app/components/locale-provider";
import { loadLocale } from "@oneverse/app/i18n";
import { publicEnvValue } from "@oneverse/app/public-env";
import { getVisitorLocale } from "@oneverse/app/server-auth";
import { ScreenDisplay } from "@oneverse/screen/components/screen-display";

/**
 * A big screen (issues #186, #305): screen.oneverse.top opened on whatever
 * drives it. No sign-in: a code and a QR code until someone pairs it on
 * Songverse's Screens page, then the set's stage. `?theme=concert` shows a
 * built-in theme instead, on this device.
 */
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { theme?: string } =>
    typeof search.theme === "string" && screenBuiltInTemplate(search.theme) ? { theme: search.theme } : {},
  beforeLoad: async () => ({ locale: await loadLocale(await getVisitorLocale()) }),
  component: ScreenPage,
});

function ScreenPage() {
  const { locale } = Route.useRouteContext();
  const { theme } = Route.useSearch();
  return (
    <LocaleProvider locale={locale}>
      <ScreenDisplay pairUrl={publicEnvValue("SONGVERSE_URL") ?? "http://localhost:3000"} pinnedTheme={theme} />
    </LocaleProvider>
  );
}
