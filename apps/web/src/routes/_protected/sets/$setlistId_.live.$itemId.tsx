import { ApiError, keptSetSong, onlineOrKept, type SetlistSongView } from "@oneverse/core";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LiveView, type LiveControl, type LiveSong } from "#/components/live-view";
import { setSongViewStore, useReadingView, type ReadingView } from "#/components/chart-or-pdf";
import { renderPlayerChart } from "#/components/player-chart";
import { Button } from "@oneverse/ui/components/button";
import { apiClient } from "#/lib/api-client";
import { deviceStorage, useKeepSet } from "#/lib/offline-data";
import { setMode } from "#/lib/mode";
import { markCurrent, markPlayed } from "#/lib/set-progress";
import { setlistTitle } from "#/lib/setlists";
import { useSongView } from "#/lib/song-views";
import { useSyncSong } from "#/lib/sync-client";
import { useStackSegues } from "#/lib/live-stack";
import { displaySeed, useDiagramPlayer, useDisplaySettings } from "#/lib/display-settings";

/** At most this many songs on one page (issue #214): a long chain of segues goes on over the next. */
const STACK_MAX = 6;

/**
 * One song of a set, full screen, in Live mode (components/live-view.tsx) -
 * and, when it segues or transitions into the next, that one stacked under
 * it, and so on (issue #214).
 */
export const Route = createFileRoute("/_protected/sets/$setlistId_/live/$itemId")({
  staticData: { fullScreen: true },
  // The page's first song, when the one playing was scrolled on into (issue #214): the page stays as it was.
  validateSearch: (search: Record<string, unknown>): { from?: string } => (typeof search.from === "string" && search.from ? { from: search.from } : {}),
  loaderDeps: ({ search }) => ({ from: search.from }),
  // Null when the set or song doesn't exist or isn't visible to this user.
  // Offline, from the set kept on the device (issue #50).
  loader: async ({ params, deps }): Promise<SetlistSongView[] | null> => {
    const load = (itemId: string) =>
      onlineOrKept(
        () =>
          apiClient.getSetlistSong(params.setlistId, itemId).catch((error: unknown) => {
            if (error instanceof ApiError && error.status === 404) return null;
            throw error;
          }),
        () => keptSetSong(deviceStorage(), params.setlistId, itemId),
      );
    // A song and the songs it runs on into, without a stop: a segue's or a transition's next.
    const chain = async (itemId: string) => {
      const first = await load(itemId);
      if (!first) return null;
      const views = [first];
      for (let last = first; views.length < STACK_MAX && last.nextItemId && (last.transition?.kind === "SEGUE" || last.transition?.kind === "TRANSITION"); ) {
        const next = await load(last.nextItemId).catch(() => null);
        if (!next) break;
        views.push(next);
        last = next;
      }
      return views;
    };
    if (deps.from && deps.from !== params.itemId) {
      const views = await chain(deps.from).catch(() => null);
      if (views?.some((view) => view.item.id === params.itemId)) return views;
    }
    return chain(params.itemId);
  },
  component: LiveRoute,
});

function LiveRoute() {
  const { t } = useTranslation();
  const views = Route.useLoaderData();
  const { itemId } = Route.useParams();
  const view = views?.[0] ?? null;
  // Kept on the device as it's opened, to play offline (issue #50).
  useKeepSet(view?.set.id);
  const stacked = useStackSegues();

  // Opened from a link, it's Live mode from here on.
  useEffect(() => setMode("live"), []);

  if (!views || !view) {
    return (
      <div className="flex min-h-dvh flex-col items-start gap-4 bg-background p-6 text-foreground">
        <h1 className="text-2xl font-semibold">{t("sets.notFoundTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("sets.notFoundDescription")}</p>
        <Button variant="outline" render={<Link to="/sets" />}>{t("sets.backToSets")}</Button>
      </div>
    );
  }
  // A song per page: the one asked for.
  const shown = stacked ? views : [views.find((one) => one.item.id === itemId) ?? views[0]!];
  return <WithReadings views={shown}>{(readings) => <SetLiveView views={shown} readings={readings} />}</WithReadings>;
}

/**
 * Each stacked song's chart or PDF, as this player reads it (issue #155):
 * one hook per song, so one component per song, nested.
 */
function WithReadings({ views, found = [], children }: { views: SetlistSongView[]; found?: ReadingView[]; children: (readings: ReadingView[]) => ReactNode }) {
  if (found.length === views.length) return children(found);
  return <OneReading view={views[found.length]!}>{(reading) => <WithReadings views={views} found={[...found, reading]} children={children} />}</OneReading>;
}

function OneReading({ view, children }: { view: SetlistSongView; children: (reading: ReadingView) => ReactNode }) {
  const reading = useReadingView(view.song?.id ?? "", undefined, view.view.liveView ?? "CHART", setSongViewStore(view.set.id, view.item.id, view.view.preferences));
  return children(reading);
}

function SetLiveView({ views, readings }: { views: SetlistSongView[]; readings: ReadingView[] }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const set = views[0]!.set;
  const control = useRef<LiveControl | null>(null);
  // How Live reads (issue #209): the account's, as the Display panel changes it.
  const display = useDisplaySettings("LIVE", displaySeed(views[0]!.view));
  const player = useDiagramPlayer(views[0]!.view);
  const [chordsChanged, setChordsChanged] = useState<Record<string, string[]>>({});
  // The song being played: the page's first, until it's scrolled on into the next (issue #214),
  // which the address then says - the page staying as it is (?from= its first song).
  const { itemId } = Route.useParams();
  const headId = views[0]!.item.id;
  const currentId = views.some((one) => one.item.id === itemId) ? itemId : headId;
  const current = views.find((one) => one.item.id === currentId)!;
  useSongView(current.song?.id);
  // Where the set is now: coming back to it picks up here (issue #153); played once its end is reached.
  useEffect(() => markCurrent(set.id, currentId), [set.id, currentId]);
  const goTo = (itemId: string | null) =>
    itemId ? () => void navigate({ to: "/sets/$setlistId/live/$itemId", params: { setlistId: set.id, itemId } }) : null;
  const onCurrent = (songId: string) => {
    // On the way to another page already (Next past the end): that one wins.
    if (songId === currentId || router.state.status !== "idle") return;
    void navigate({
      to: "/sets/$setlistId/live/$itemId",
      params: { setlistId: set.id, itemId: songId },
      search: songId === headId ? {} : { from: headId },
      replace: true,
      resetScroll: false,
    });
  };
  // Sync play (issue #13): the leader's song, followed - scrolled to, when it's on this page.
  useSyncSong(set.id, currentId, (itemId) => {
    if (!control.current?.goTo(itemId)) goTo(itemId)?.();
  });

  const songs: LiveSong[] = views.map((view, i) => {
    const { item, song } = view;
    return {
      id: item.id,
      title: song?.title ?? t("sets.hiddenSong"),
      artist: song?.artists?.join(", ") || null,
      setName: setlistTitle(set, t, i18n.language),
      setId: set.id,
      chartFor: (extraSteps) => (song ? renderPlayerChart(view, undefined, display.chordNotation, display.capoDisplayMode, extraSteps) : null),
      keyShift: (view.arrangement?.document.defaults.transposeSteps ?? 0) + item.transposeSteps,
      durationSeconds: song?.document.defaults.durationSeconds,
      arrangementName: view.arrangement?.name ?? null,
      // A copy kept before #59 has none.
      references: view.songbookReferences ?? [],
      setNotes: item.notes ? [{ text: item.notes }] : [],
      // Notes seen in this set (issue #256).
      notes: song ? { context: { songVersionId: song.id, setlistId: set.id }, document: song.document } : undefined,
      onPlayed: () => markPlayed(set.id, item.id),
      reading: song ? (readings[i] ?? null) : null,
      previous: goTo(view.previousItemId),
      next: goTo(view.nextItemId),
      nextLabel: view.nextItemId ? (view.nextTitle ? t("live.nextUp", { title: view.nextTitle }) : t("live.nextHidden")) : t("live.endOfSet"),
      // The chords as just changed here, before the page next loads.
      transition: view.transition ? { ...view.transition, chords: chordsChanged[item.id] ?? view.transition.chords } : null,
      player,
      songVersionId: song?.id,
      // Changed here by who can change the set (issue #214), online.
      // Shown at once, and saved - without reloading the page under the player's scroll; put back if it can't be.
      onTransitionChords: set.canEdit
        ? (transitionChords) => {
            const before = chordsChanged[item.id];
            setChordsChanged((all) => ({ ...all, [item.id]: transitionChords }));
            apiClient.updateSetlistItem(set.id, item.id, { transitionChords }).catch(() => setChordsChanged((all) => ({ ...all, [item.id]: before ?? view.transition?.chords ?? [] })));
          }
        : undefined,
    };
  });
  return <LiveView songs={songs} display={display} startAt={currentId} onCurrent={onCurrent} control={control} />;
}
