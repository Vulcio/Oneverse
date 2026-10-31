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
    <TeamAccessDialog
      testId="set-team-access"
      song={asking?.title ?? null}
      team={team}
      description={t("sets.teamAccess.description", { team })}
      busy={addingId !== null}
      error={asking ? error : null}
      onChoose={(access) => asking && void add(asking.set, asking.songVersionId, asking.title, access)}
      onCancel={() => setAsking(null)}
    />
  );

  return { add, addingId, error, dialog };
}

/**
 * Asks whether one's own personal song going where a team uses it - its set,
 * its songbook (issue #340) - is shared with the team or moved to it.
 * Open while `song` is set.
 */
export function TeamAccessDialog({
  testId,
  song,
  team,
  description,
  busy,
  error,
  onChoose,
  onCancel,
}: {
  testId: string;
  song: string | null;
  team: string;
  description: string;
  busy: boolean;
  error: string | null;
  onChoose: (access: "share" | "move") => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={song !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{t("sets.teamAccess.title", { song: song ?? "", team })}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Button type="button" disabled={busy} onClick={() => onChoose("share")} data-testid={`${testId}-share`}>
              {t("sets.teamAccess.share", { team })}
            </Button>
            <p className="text-xs text-muted-foreground">{t("sets.teamAccess.shareHint")}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onChoose("move")} data-testid={`${testId}-move`}>
              {t("sets.teamAccess.move", { team })}
            </Button>
            <p className="text-xs text-muted-foreground">{t("sets.teamAccess.moveHint")}</p>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="button" variant="ghost" className="self-end" onClick={onCancel}>
            {t("sets.teamAccess.cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
