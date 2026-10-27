import { ApiError, type SetlistDetail, type SetlistSummary } from "@oneverse/core";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { apiClient } from "#/lib/api-client";

type SetRef = Pick<SetlistSummary, "id" | "teamName">;

/**
 * Adding a song to a set, from anywhere that adds one (Add songs, a song's
 * Add to set, a drop on a set): one of the user's own personal songs going
 * into a team's set is refused until it's shared with the team (issue #331,
 * SONG_NOT_SHARED), so this asks - share it with the team (the first choice,
 * it stays theirs) or move it to the team - then adds it. `dialog` goes in
 * the page.
 */
export function useAddSongToSet(onAdded: (set: SetlistDetail) => void) {
  const { t } = useTranslation();
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ set: SetRef; songVersionId: string; title: string } | null>(null);

  /** Adds it, or asks first; what went wrong, if anything did. */
  async function add(set: SetRef, songVersionId: string, title: string, teamAccess?: "share" | "move"): Promise<string | null> {
    setAddingId(songVersionId);
    setError(null);
    try {
      onAdded(await apiClient.addSetlistItem(set.id, { songVersionId, ...(teamAccess && { teamAccess }) }));
      setAsking(null);
      return null;
    } catch (err) {
      if (err instanceof ApiError && err.code === "SONG_NOT_SHARED") {
        setAsking({ set, songVersionId, title });
        return null;
      }
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return message;
    } finally {
      setAddingId(null);
    }
  }

  const team = asking?.set.teamName ?? "";
  const dialog: ReactNode = (
    <Dialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
      <DialogContent data-testid="set-team-access">
        <DialogHeader>
          <DialogTitle>{t("sets.teamAccess.title", { song: asking?.title ?? "", team })}</DialogTitle>
          <DialogDescription>{t("sets.teamAccess.description", { team })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Button type="button" disabled={addingId !== null} onClick={() => asking && void add(asking.set, asking.songVersionId, asking.title, "share")} data-testid="set-team-access-share">
              {t("sets.teamAccess.share", { team })}
            </Button>
            <p className="text-xs text-muted-foreground">{t("sets.teamAccess.shareHint")}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Button type="button" variant="outline" disabled={addingId !== null} onClick={() => asking && void add(asking.set, asking.songVersionId, asking.title, "move")} data-testid="set-team-access-move">
              {t("sets.teamAccess.move", { team })}
            </Button>
            <p className="text-xs text-muted-foreground">{t("sets.teamAccess.moveHint")}</p>
          </div>
          {asking && error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="button" variant="ghost" className="self-end" onClick={() => setAsking(null)}>
            {t("sets.teamAccess.cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { add, addingId, error, dialog };
}
