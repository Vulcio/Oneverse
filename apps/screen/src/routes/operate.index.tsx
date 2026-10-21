import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { publicEnvValue } from "@oneverse/app/public-env";
import { setlistTitle } from "@oneverse/screen/lib/set-items";
import { apiClient } from "#/lib/api-client";

/** The sets the operator can open (issue #305): one picked, its console. */
export const Route = createFileRoute("/operate/")({
  loader: () => apiClient.listSetlists(),
  component: SetPicker,
});

function SetPicker() {
  const { t, i18n } = useTranslation();
  const sets = Route.useLoaderData().filter((set) => !set.past);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("screens.operator.pickTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("screens.operator.pickDescription")}</p>
      </div>
      {sets.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="operate-no-sets">
          {t("screens.operator.noSets")}{" "}
          <a className="underline" href={publicEnvValue("SONGVERSE_URL") ?? "http://localhost:3000"}>
            {t("screens.operator.openSongverse")}
          </a>
        </p>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="operate-sets">
          {sets.map((set) => (
            <li key={set.id}>
              <Link to="/operate/$setlistId" params={{ setlistId: set.id }} className="flex items-center gap-3 px-4 py-3 hover:bg-accent" data-testid="operate-set">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{setlistTitle(set, t, i18n.language)}</span>
                  <span className="block truncate text-sm text-muted-foreground">{set.teamName ?? set.ownerName}</span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
