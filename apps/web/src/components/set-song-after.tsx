import { degreeChords, SET_TRANSITIONS, type SetlistSongView, type SetTransitionValue } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CornerDownRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { PlayerChart } from "#/components/player-chart";
import { TransitionChordsPicker, TransitionSymbol, TransitionVariations, transitionText } from "#/components/set-transition";
import { apiClient } from "#/lib/api-client";

/**
 * Under a set's song, out of Live: what happens after it (issue #199) - chosen
 * here by who can change the set, with a transition's note and the chords into
 * the next song (#10) - and, when it runs on into the next (a segue or a
 * transition), that song underneath, as Live stacks it (#214).
 */
export function SetSongAfter({ view, onChanged }: { view: SetlistSongView; onChanged: () => void }) {
  const { t } = useTranslation();
  const { set, item, transition } = view;
  const [saving, setSaving] = useState(false);
  const runsOn = transition?.kind === "SEGUE" || transition?.kind === "TRANSITION";
  const next = useNextSong(set.id, runsOn ? view.nextItemId : null);
  if (!view.nextItemId || (!set.canEdit && !transition)) return null;

  const save = (change: Parameters<typeof apiClient.updateSetlistItem>[2]) => {
    setSaving(true);
    void apiClient
      .updateSetlistItem(set.id, item.id, change)
      .then(onChanged)
      .finally(() => setSaving(false));
  };
  const isTransition = transition?.kind === "TRANSITION";
  const chords = transition?.chords ?? [];
  const spelled = transition?.toKey ? degreeChords(chords, transition.toKey) : chords;

  return (
    <>
      <Card data-testid="set-song-after-card">
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {transition ? <TransitionSymbol kind={transition.kind} className="size-4 text-primary" /> : <CornerDownRight className="size-4 text-muted-foreground" aria-hidden />}
              {t("sets.afterThisSong")}
            </span>
            {set.canEdit ? (
              <NativeSelect
                aria-label={t("sets.afterThisSong")}
                value={transition?.kind ?? ""}
                disabled={saving}
                onChange={(event) => save({ transition: (event.target.value || null) as SetTransitionValue | null })}
                compact
                className="text-sm"
                data-testid="set-song-page-transition"
              >
                <option value="">{t("sets.transitions.none")}</option>
                {SET_TRANSITIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`sets.transitions.${kind}`)}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {view.nextTitle ? (
              <span className="text-sm text-muted-foreground">{t("live.nextUp", { title: view.nextTitle })}</span>
            ) : null}
          </div>
          {/* "Key change G → A · 72 → 96 BPM", as Live says it. */}
          {transition ? <p className="text-sm text-muted-foreground" data-testid="set-song-page-transition-text">{transitionText({ ...transition, note: set.canEdit ? null : transition.note }, t)}</p> : null}
          {isTransition && set.canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* The way into the next song: its style and its chords, chosen here as on the set's page. */}
              {view.song ? (
                <>
                  <TransitionChordsPicker fromKey={transition.fromKey} toKey={transition.toKey} lastChord={transition.lastChord} firstChord={transition.firstChord} degrees={chords} onChange={(transitionChords) => save({ transitionChords })} />
                  <TransitionVariations fromKey={transition.fromKey} toKey={transition.toKey} lastChord={transition.lastChord} firstChord={transition.firstChord} degrees={chords} onChange={(transitionChords) => save({ transitionChords })} />
                </>
              ) : null}
              <Input
                key={transition.note ?? ""}
                defaultValue={transition.note ?? ""}
                maxLength={200}
                placeholder={t("sets.transitionNote")}
                aria-label={t("sets.transitionNote")}
                className="h-8 w-64 max-w-full text-sm"
                onBlur={(event) => event.target.value.trim() !== (transition.note ?? "") && save({ transitionNote: event.target.value })}
                data-testid="set-song-page-transition-note"
              />
            </div>
          ) : isTransition && spelled.length > 0 ? (
            <p className="text-sm" data-testid="set-song-page-transition-chords">
              {t("sets.transitionChordsLive")} <span className="font-semibold">{spelled.join(" ")}</span>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* The next song underneath, when this one runs on into it. */}
      {runsOn && next?.song ? (
        <section className="flex flex-col gap-2" data-testid="set-song-next">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-muted-foreground">
              {next.song.title}
              {next.song.versionName ? <span className="font-normal"> — {next.song.versionName}</span> : null}
            </h2>
            <Button variant="ghost" size="sm" render={<Link to="/sets/$setlistId/songs/$itemId" params={{ setlistId: set.id, itemId: next.item.id }} />}>
              {t("sets.nextSong")}
              <ChevronRight />
            </Button>
          </div>
          <Card>
            <CardContent>
              <PlayerChart view={next} />
            </CardContent>
          </Card>
        </section>
      ) : null}
    </>
  );
}

/** The next song of the set, to show underneath; null while it loads, or when it can't be read. */
function useNextSong(setId: string, itemId: string | null): SetlistSongView | null {
  const [next, setNext] = useState<SetlistSongView | null>(null);
  useEffect(() => {
    setNext(null);
    if (!itemId) return;
    let live = true;
    apiClient.getSetlistSong(setId, itemId).then(
      (view) => live && setNext(view),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [setId, itemId]);
  return next;
}
