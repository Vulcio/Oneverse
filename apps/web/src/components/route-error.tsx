import { ApiError, isNetworkError } from "@oneverse/core";
import { reportPageError } from "@oneverse/app/error-reports";
import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { WifiOff } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";

/**
 * A page that couldn't load. Offline, that's a page not kept on this
 * device: say so plainly (issue #49), never send the player to sign in.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const offline = isNetworkError(error);
  // A bug, not an answer (issue #469): the API's own answers - a 404, a refusal, its 500s - are reported, or not, by it.
  useEffect(() => {
    if (!offline && !(error instanceof ApiError)) reportPageError(error);
  }, [error, offline]);
  return (
    <div className="flex flex-col items-start gap-4 p-6" data-testid={offline ? "not-available-offline" : "route-error"}>
      {offline ? <WifiOff className="size-6 text-muted-foreground" /> : null}
      <h1 className="text-2xl font-semibold">{offline ? t("offline.notAvailableTitle") : t("offline.errorTitle")}</h1>
      <p className="text-sm text-muted-foreground">{offline ? t("offline.notAvailable") : error instanceof Error ? error.message : String(error)}</p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          {t("offline.retry")}
        </Button>
        <Button variant="ghost" render={<Link to="/sets" />}>{t("sets.backToSets")}</Button>
      </div>
    </div>
  );
}
