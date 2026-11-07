import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { currentSet, todayIso } from "#/lib/setlists";

/**
 * The "Current set" shortcut (issue #404, the manifest's `shortcuts`): today's
 * set or the next one, or the Sets page when none is coming up. Chosen in the
 * browser, on the device's date - the server's may be another day - from the
 * sets the app has (the device's copy offline).
 */
export const Route = createFileRoute("/_protected/sets/current")({
  component: CurrentSet,
});

function CurrentSet() {
  const { t } = useTranslation();
  const { setlists } = Route.useRouteContext();
  const navigate = useNavigate();

  useEffect(() => {
    const set = currentSet(setlists, todayIso());
    if (set) void navigate({ to: "/sets/$setlistId", params: { setlistId: set.id }, replace: true });
    else void navigate({ to: "/sets", replace: true });
  }, [setlists, navigate]);

  return (
    <p className="text-sm text-muted-foreground" data-testid="current-set-opening">
      {t("common.loading")}
    </p>
  );
}
