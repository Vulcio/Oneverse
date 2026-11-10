import type { SetlistDetail } from "@oneverse/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { apiClient } from "#/lib/api-client";
import { artistNames } from "#/lib/artists";
import type { FoundSong } from "#/lib/song-search";
import { SongPicker } from "#/components/song-picker";
import { TextItemDialog } from "#/components/set-text-item";
import { PassageItemDialog } from "#/components/set-passage-item";
import { useAddSongToSet } from "#/components/set-team-access";

/**
 * Search box listing songs that can go in this set - found as the search box
 * finds them (issue #328: title, artist, songbook number, CCLI, in lyrics);
 * with no query, the most recently edited ones.
 */
export function AddSongs({ set, onAdded }: { set: SetlistDetail; onAdded: (set: SetlistDetail) => void }) {
  const { t } = useTranslation();
  const [recent, setRecent] = useState<FoundSong[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // One of your own songs in a team's set: shared with the team or moved to it as it's added (issue #331).
  const { add, addingId, error: addError, dialog } = useAddSongToSet(onAdded);
  const error = loadError ?? addError;

  // Nothing typed: the songs edited last.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .listSongVersions({ addableTo: set.id, pageSize: 8, references: true })
      .then((page) =>
        !cancelled &&
        setRecent(page.items.map((song) => ({ id: song.id, title: song.title, versionName: song.versionName, artists: artistNames(song.artists), references: song.songbookReferences ?? [] }))),
      )
      .catch((err: unknown) => !cancelled && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [set.id]);

  return (
    <div className="flex flex-col gap-3">
      <SongPicker
        addableTo={set.id}
        lyrics
        suggestions={recent}
        placeholder={t("sets.searchPlaceholder")}
        empty={t("sets.noResults")}
        disabled={addingId !== null}
        onPick={(song) => void add(set, song.id, song.label)}
        // The row itself adds (a click on it, Enter); the button says so, and its click is the row's.
        action={() => (
          <Button size="sm" variant="outline" disabled={addingId !== null}>
            {t("sets.add")}
          </Button>
        )}
        testIds={{ list: "set-song-results", lyrics: "set-search-in-lyrics" }}
      />
      {set.teamId ? <p className="text-xs text-muted-foreground">{t("sets.teamSongsOnly")}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {dialog}
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
