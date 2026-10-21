import type { SetlistDetail, SetlistSongRef } from "@oneverse/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Input } from "@oneverse/ui/components/input";
import { apiClient } from "#/lib/api-client";
import { TextItemDialog } from "#/components/set-text-item";
import { PassageItemDialog } from "#/components/set-passage-item";

const SEARCH_DEBOUNCE_MS = 250;

/** Search box listing songs that can go in this set; with no query, the most recently edited ones. */
export function AddSongs({ set, onAdded }: { set: SetlistDetail; onAdded: (set: SetlistDetail) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SetlistSongRef[] | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      apiClient
        .searchSetlistSongs(set.id, query)
        .then((songs) => !cancelled && setResults(songs))
        .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [set.id, query]);

  async function add(song: SetlistSongRef) {
    setAddingId(song.id);
    setError(null);
    try {
      onAdded(await apiClient.addSetlistItem(set.id, { songVersionId: song.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("sets.searchPlaceholder")}
        aria-label={t("sets.searchPlaceholder")}
      />
      {set.teamId ? <p className="text-xs text-muted-foreground">{t("sets.teamSongsOnly")}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {results === null ? null : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sets.noResults")}</p>
      ) : (
        <ul className="flex flex-col divide-y" data-testid="set-song-results">
          {results.map((song) => (
            <li key={song.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {song.title}
                  {song.versionName ? <span className="font-normal text-muted-foreground"> — {song.versionName}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[song.key, song.ownerScope === "GLOBAL" ? t("sets.scopeGlobal") : song.ownerScope === "TEAM" ? song.teamName : t("sets.scopePersonal")]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={addingId !== null} onClick={() => void add(song)}>
                {t("sets.add")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Slides of text for the screens (issue #305): a welcome, a reading, announcements. */
export function AddText({ set, onAdded }: { set: SetlistDetail; onAdded: (set: SetlistDetail) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs text-muted-foreground">{t("sets.text.addHint")}</p>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="set-add-text">
        {t("sets.text.add")}
      </Button>
      {open ? <TextItemDialog open={open} onOpenChange={setOpen} text={null} onSave={async (text) => onAdded(await apiClient.addSetlistItem(set.id, { text }))} /> : null}
    </div>
  );
}

/** A Bible passage for the screens (issue #301): an imported Bible and a reference. */
export function AddPassage({ set, onAdded }: { set: SetlistDetail; onAdded: (set: SetlistDetail) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs text-muted-foreground">{t("sets.passage.addHint")}</p>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="set-add-passage">
        {t("sets.passage.add")}
      </Button>
      {open ? <PassageItemDialog open={open} onOpenChange={setOpen} passage={null} onSave={async (passage, screenTemplate) => onAdded(await apiClient.addSetlistItem(set.id, { passage, ...(screenTemplate && { screenTemplate }) }))} /> : null}
    </div>
  );
}
