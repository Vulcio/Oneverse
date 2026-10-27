import type { QuickSelectionAdded, SetlistSummary } from "@oneverse/core";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ListPlus, Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { apiClient } from "#/lib/api-client";
import { addQuickSelectionTo, clearQuickSelection, removeFromQuickSelection, useQuickSelection } from "#/lib/quick-selection";
import { setlistTitle, setOwnerLabel, todayIso } from "#/lib/setlists";

/**
 * The Quick selection (issue #334): songs gathered from a song, the
 * library or the search box, then put in a set all at once - or in a new
 * set made from them.
 */
export const Route = createFileRoute("/_protected/quick-selection")({
  loader: () => apiClient.listSetlists(),
  component: QuickSelectionPage,
});

/** The sets the songs can go in: ones you can change, not over. */
const openSets = (sets: SetlistSummary[]) => sets.filter((set) => set.canEdit && !set.past && (set.eventDate === null || set.eventDate >= todayIso()));

function QuickSelectionPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const sets = openSets(Route.useLoaderData());
  const selection = useQuickSelection();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuickSelectionAdded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const songs = selection?.songs ?? [];

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const skipped = (reason: "in-set" | "not-addable") => result?.skipped.filter((song) => song.reason === reason).map((song) => song.title) ?? [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6" data-testid="quick-selection-page">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("quickSelection.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("quickSelection.description")}</p>
      </div>

      {result ? (
        <div role="status" className="flex flex-col gap-1 rounded-md border bg-muted/50 px-4 py-3 text-sm" data-testid="quick-selection-result">
          <p>
            {t("quickSelection.added", { count: result.added, set: setlistTitle(result.set, t, i18n.language) })}{" "}
            <Link to="/sets/$setlistId" params={{ setlistId: result.set.id }} className="font-medium underline-offset-2 hover:underline">
              {t("sets.dropOnSet.open")}
            </Link>
          </p>
          {skipped("in-set").length ? <p className="text-muted-foreground">{t("quickSelection.alreadyIn", { songs: skipped("in-set").join(", ") })}</p> : null}
          {skipped("not-addable").length ? <p className="text-muted-foreground">{t("quickSelection.notAddable", { songs: skipped("not-addable").join(", ") })}</p> : null}
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{t("quickSelection.count", { count: songs.length })}</p>
            {songs.length ? (
              <ConfirmButton
                label={t("quickSelection.clear")}
                confirmLabel={t("quickSelection.clearConfirm")}
                busyLabel={t("quickSelection.clearing")}
                cancelLabel={t("quickSelection.cancel")}
                busy={busy}
                onConfirm={() => run(clearQuickSelection)}
              />
            ) : null}
          </div>
          {selection === null ? null : songs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("quickSelection.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="quick-selection-songs">
              {songs.map((song) => (
                <li key={song.id} className="flex items-center gap-3 py-2">
                  <Link to="/library/$songVersionId" params={{ songVersionId: song.id }} className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{song.versionName ? `${song.title} — ${song.versionName}` : song.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[song.artists?.join(", "), song.key].filter(Boolean).join(" · ")}</span>
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={t("quickSelection.removeSong", { title: song.title })}
                    onClick={() => void run(() => removeFromQuickSelection(song.id))}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {songs.length ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="font-medium">{t("quickSelection.addTo")}</p>
            {sets.length === 0 ? <p className="text-sm text-muted-foreground">{t("sets.addToSet.none")}</p> : null}
            <ul className="flex flex-col gap-1" data-testid="quick-selection-sets">
              {sets.map((set) => (
                <li key={set.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setResult(await addQuickSelectionTo(set.id));
                        // The sidebar's song counts.
                        await router.invalidate();
                      })
                    }
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&_svg]:size-4"
                    data-testid="quick-selection-set"
                    data-set-id={set.id}
                  >
                    <ListPlus className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{setlistTitle(set, t, i18n.language)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[setOwnerLabel(set, t), t("nav.itemCount", { count: set.itemCount })].join(" · ")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Link
              to="/sets/new"
              search={{ quick: true }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
              data-testid="quick-selection-new-set"
            >
              <Plus className="text-muted-foreground" />
              {t("quickSelection.newSet")}
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
