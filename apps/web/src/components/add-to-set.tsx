import type { SetForSong } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { Check, ListPlus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { cn } from "@oneverse/ui/lib/utils";
import { apiClient } from "#/lib/api-client";
import { setlistTitle, setOwnerLabel } from "#/lib/setlists";

/**
 * Add to set, on a song (issue #330): the sets you can change that aren't
 * over, soonest first. One it's in already is ticked, one it can't go in
 * (a team set and a song that isn't the team's) says so; picking another
 * puts the song at its end. New set… makes one with the song in it.
 */
export function AddToSetButton({ songVersionId, className, labelClassName }: { songVersionId: string; className?: string; labelClassName?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" className={className} aria-label={t("sets.addToSet.button")} data-testid="add-to-set">
            <ListPlus />
            <span className={labelClassName}>{t("sets.addToSet.button")}</span>
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 p-0" data-testid="add-to-set-list">
        {open ? <SetChoices songVersionId={songVersionId} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function SetChoices({ songVersionId }: { songVersionId: string }) {
  const { t, i18n } = useTranslation();
  const [sets, setSets] = useState<SetForSong[] | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .setsForSong(songVersionId)
      .then((found) => !cancelled && setSets(found))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [songVersionId]);

  async function add(set: SetForSong) {
    setAddingId(set.id);
    setError(null);
    try {
      await apiClient.addSetlistItem(set.id, { songVersionId });
      setSets((current) => current && current.map((each) => (each.id === set.id ? { ...each, hasSong: true, itemCount: each.itemCount + 1 } : each)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="flex flex-col">
      <p className="border-b px-3 py-2 text-sm font-medium">{t("sets.addToSet.title")}</p>
      {error ? <p className="px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {sets === null ? (
        error ? null : <p className="px-3 py-2 text-sm text-muted-foreground">{t("sets.addToSet.loading")}</p>
      ) : sets.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{t("sets.addToSet.none")}</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto py-1">
          {sets.map((set) => {
            const title = setlistTitle(set, t, i18n.language);
            const detail = set.hasSong
              ? t("sets.addToSet.inIt")
              : !set.canAddSong
                ? t("sets.addToSet.notAddable")
                : [setOwnerLabel(set, t), t("nav.itemCount", { count: set.itemCount })].join(" · ");
            return (
              <li key={set.id} className="flex items-center gap-1 px-1">
                <button
                  type="button"
                  disabled={set.hasSong || !set.canAddSong || addingId !== null}
                  onClick={() => void add(set)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent",
                    !set.canAddSong && !set.hasSong && "opacity-60",
                  )}
                  data-testid="add-to-set-choice"
                  data-set-id={set.id}
                  data-state={set.hasSong ? "in" : set.canAddSong ? "addable" : "refused"}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">{set.hasSong ? <Check className="text-primary" /> : <Plus className="text-muted-foreground" />}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                  </span>
                </button>
                {set.hasSong ? (
                  <Button variant="ghost" size="sm" render={<Link to="/sets/$setlistId" params={{ setlistId: set.id }} />}>
                    {t("sets.addToSet.open")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-t p-1">
        <Link
          to="/sets/new"
          search={{ song: songVersionId }}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
          data-testid="add-to-new-set"
        >
          <Plus className="text-muted-foreground" />
          {t("sets.addToSet.newSet")}
        </Link>
      </div>
    </div>
  );
}
