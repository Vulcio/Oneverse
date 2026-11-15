import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { currentSet, todayIso } from "#/lib/setlists";

/**
 * The "Current set" shortcut (issue #404, the manifest's `shortcuts`): today's
 * set or the next one, or the Sets page when none is coming up. With
 * `?to=operate` (issue #358, the sidebar's Operator), its operator's view. Chosen in the
 * browser, on the device's date - the server's may be another day - from the
 * sets the app has (the device's copy offline).
 */
export const Route = createFileRoute("/_protected/sets/current")({
  validateSearch: (search: Record<string, unknown>): { to?: "operate" } => (search.to === "operate" ? { to: "operate" } : {}),
  component: CurrentSet,
});

function CurrentSet() {
  const { t } = useTranslation();
  const { setlists } = Route.useRouteContext();
  const { to } = Route.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    const set = currentSet(setlists, todayIso());
    if (set && to === "operate") void navigate({ to: "/sets/$setlistId/operate", params: { setlistId: set.id }, replace: true });
    else if (set) void navigate({ to: "/sets/$setlistId", params: { setlistId: set.id }, replace: true });
    else void navigate({ to: "/sets", replace: true });
  }, [setlists, navigate, to]);

  return (
    <p className="text-sm text-muted-foreground" data-testid="current-set-opening">
      {t("common.loading")}
    </p>
  );
}
