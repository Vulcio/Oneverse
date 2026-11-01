import { ApiError, cueSectionsOf, keptSetSong, onlineOrKept, transposeKey, type Attachment, type SetlistSongView, type SongLink } from "@oneverse/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MetronomeSongButton } from "#/components/metronome";
import { PlayerChart } from "#/components/player-chart";
import { SyncControl } from "#/components/sync-control";
import { useSongPlayback } from "#/components/song-playback";
import { setPlaybackStore, usePrefetchSetItem } from "#/lib/playback";
import { fileLoader, songFiles } from "#/lib/song-files";
import { ChartOrPdf, setSongViewStore } from "#/components/chart-or-pdf";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { useMode } from "#/lib/mode";
import { deviceStorage, useKeepSet } from "#/lib/offline-data";
import { setItemTitle, setlistTitle, transposeLabel } from "#/lib/setlists";
import { TextItemSlides } from "#/components/set-text-item";
import { PassageReading } from "#/components/set-passage-item";
import { useSongView } from "#/lib/song-views";
import { useSyncSong } from "#/lib/sync-client";

/**
 * One song of a set, readable by anyone who can open the set - guests
 * included, and songs that aren't in the viewer's own library - with the
 * notes seen in the set (issue #256) and a way through the set in order.
 */
export const Route = createFileRoute("/_protected/sets/$setlistId_/songs/$itemId")({
  // A note's thread to open (issue #256): from a notification.
  validateSearch: (search: Record<string, unknown>): { note?: string } => (typeof search.note === "string" && search.note ? { note: search.note } : {}),
  // Null when the set or song doesn't exist or isn't visible to this user.
  // Offline, from the set kept on the device (issue #50).
  loader: ({ params }) =>
    onlineOrKept(
      () =>
        apiClient.getSetlistSong(params.setlistId, params.itemId).catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }),
      () => keptSetSong(deviceStorage(), params.setlistId, params.itemId),
    ),
  component: SetSongRoute,
});

function SetSongRoute() {
  const { t } = useTranslation();
  const view = Route.useLoaderData();
  // Kept on the device as it's opened, to play offline (issue #50).
  useKeepSet(view?.set.id);
  if (!view) {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">{t("sets.notFoundTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("sets.notFoundDescription")}</p>
        <Button variant="outline" render={<Link to="/sets" />}>{t("sets.backToSets")}</Button>
      </div>
    );
  }
  return <SetSongPage view={view} />;
}

function SetSongPage({ view }: { view: SetlistSongView }) {
  const { t, i18n } = useTranslation();
  const { set, item, song } = view;
  const { note } = Route.useSearch();
  const navigate = useNavigate();
  useSongView(song?.id);
  // Sync play (issue #13): the leader's song, followed.
  useSyncSong(set.id, item.id, (itemId) => void navigate({ to: "/sets/$setlistId/songs/$itemId", params: { setlistId: set.id, itemId } }));

  // The arrangement's key and tempo, with the set's own key on top.
  const arrangement = view.arrangement?.document.defaults;
  const tempo = arrangement?.tempo ?? song?.tempo;
  const details = [
    t("sets.songOfSet", { position: item.position + 1, count: set.itemCount }),
    // The set's own transposition, from the arrangement's key.
    song ? transposeLabel(song.key && arrangement ? (transposeKey(song.key, arrangement.transposeSteps) ?? song.key) : song.key, item.transposeSteps, t) : null,
    view.arrangement ? t("sets.playedAs", { name: view.arrangement.name }) : null,
    tempo ? `${tempo} BPM` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const reference = useVersionReference(song?.id ?? null, view.arrangement?.linkId ?? null);
  const { mode } = useMode();
  const files = useSetSongFiles(song?.id ?? null, mode === "practice");
  const returnTo = `/sets/${set.id}/songs/${item.id}`;
  const timeSignature = arrangement?.timeSignature ?? song?.document.defaults.timeSignature ?? null;
  const setName = setlistTitle(set, t, i18n.language);
  // What plays with it (issue #366): the person's choice for the song in this set, or the Sync play leader's for everyone.
  const playbackStore = useMemo(() => setPlaybackStore(set.id, item.id, view.view.preferences?.playback), [set.id, item.id]);
  const playback = useSongPlayback({
    songVersionId: song?.id ?? "",
    title: song?.title ?? "",
    returnTo,
    attachments: files.attachments,
    load: fileLoader(song?.id ?? "", files.offline),
    // The version's reference video (issue #346), from its start; else the song's own.
    youtube: youtubeOf(reference, files.songVideo),
    tempo,
    timeSignature,
    store: playbackStore,
    set: { id: set.id, itemId: item.id, name: setName },
    versionMultitrackId: view.arrangement?.multitrackId ?? null,
    // Chosen for the song in this set: the set's own multitrack by default (issue #127).
    choiceKey: song ? `${song.id}@${set.id}` : undefined,
    stems: {
      songKey: song?.key,
      // The key the set plays it in: its arrangement's, with the set's own transposition on top.
      targetKey: song?.key ? transposeKey(song.key, (arrangement?.transposeSteps ?? 0) + item.transposeSteps) : null,
      cueSections: files.cueSections,
      record: files.offline ? undefined : { attachments: files.attachments, setlist: { id: set.id, name: setName }, onSaved: files.reload },
    },
    docked: !!song && mode === "practice",
  });
  // The next song's, fetched ahead while this one's open (issue #366).
  usePrefetchSetItem(set.id, view.nextItemId ?? null, mode === "practice");

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/sets/$setlistId"
        params={{ setlistId: set.id }}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {setlistTitle(set, t, i18n.language)}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold">{setItemTitle(view, t)}</h1>
          <p className="text-sm text-muted-foreground">{details}</p>
          {reference ? (
            <a href={reference.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 self-start text-sm text-primary hover:underline" data-testid="version-reference">
              <ExternalLink className="size-3.5" />
              {t("sets.versionReference", { label: reference.label })}
            </a>
          ) : null}
          {view.sharedBy ? (
            <div>
              <Badge variant="muted">{t("sets.sharedBy", { name: view.sharedBy.displayName })}</Badge>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncControl setId={set.id} className="h-8" />
          {song && mode === "practice" ? playback.control : null}
          {song && !(mode === "practice" && playback.source === "METRONOME") ? (
            <MetronomeSongButton
              songId={item.id}
              tempo={tempo}
              timeSignature={arrangement?.timeSignature ?? song.document.defaults.timeSignature}
              variant="button"
              className="h-8"
            />
          ) : null}
          {song && view.inLibrary ? (
            <Button variant="outline" size="sm" render={<Link to="/library/$songVersionId" params={{ songVersionId: song.id }} />}>
                {t("sets.openInLibrary")}
              </Button>
          ) : null}
        </div>
      </div>

      {/* What plays with it, docked at the bottom (issues #64, #66, #366). */}
      {playback.dock}

      {song ? (
        // The chart, its chord grid (issue #238) or the song's PDF (issue #152).
        <ChartOrPdf
          songVersionId={song.id}
          defaultView={view.view.liveView ?? "CHART"}
          store={setSongViewStore(set.id, item.id, view.view.preferences)}
          grid={
            <Card>
              <CardContent>
                <PlayerChart view={view} openNoteId={note} grid />
              </CardContent>
            </Card>
          }
        >
          <Card>
            <CardContent>
              <PlayerChart view={view} openNoteId={note} />
            </CardContent>
          </Card>
        </ChartOrPdf>
      ) : view.text ? (
        // Slides of text (issue #305), as the screens show them.
        <Card>
          <CardContent>
            <TextItemSlides text={view.text} />
          </CardContent>
        </Card>
      ) : view.passage ? (
        // A Bible passage (issue #301), with its copyright beneath.
        <Card>
          <CardContent>
            <PassageReading passage={view.passage} />
          </CardContent>
        </Card>
      ) : null}

      {item.notes ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("sets.setNotes")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{item.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      <nav className="flex items-center justify-between gap-3" aria-label={t("sets.songs")}>
        {view.previousItemId ? (
          <Button variant="outline" render={<Link to="/sets/$setlistId/songs/$itemId" params={{ setlistId: set.id, itemId: view.previousItemId }} />}>
              <ChevronLeft />
              {t("sets.previousSong")}
            </Button>
        ) : (
          <span />
        )}
        {view.nextItemId ? (
          <Button variant="outline" render={<Link to="/sets/$setlistId/songs/$itemId" params={{ setlistId: set.id, itemId: view.nextItemId }} />}>
              {t("sets.nextSong")}
              <ChevronRight />
            </Button>
        ) : null}
      </nav>
    </div>
  );
}

/** A set's song's files, for what plays with it (issue #366): from the API, or the device's copy offline; listed in Practice only. */
function useSetSongFiles(songVersionId: string | null, listed: boolean) {
  // Bumped when a part's recorded here, to list the files again.
  const [reload, setReload] = useState(0);
  const [files, setFiles] = useState<{ attachments: Attachment[]; offline: boolean; songVideo: string | null; cueSections?: ReturnType<typeof cueSectionsOf> }>({
    attachments: [],
    offline: false,
    songVideo: null,
  });
  useEffect(() => {
    if (!listed || !songVersionId) return;
    let cancelled = false;
    Promise.all([songFiles(songVersionId), apiClient.getSongVersion(songVersionId).catch(() => null)])
      .then(([files, version]) => ({
        ...files,
        songVideo: version?.identifiers.find((identifier) => identifier.type === "YOUTUBE")?.value ?? null,
        // Its sections, for the cue points (issue #110).
        ...(version ? { cueSections: cueSectionsOf(version.documentJson) } : {}),
      }))
      .then((next) => {
        if (!cancelled) setFiles(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [listed, songVersionId, reload]);
  return { ...files, reload: () => setReload((n) => n + 1) };
}

/** The video a set's song plays: its version's reference recording when it's a YouTube video (issue #346), else the song's own. */
function youtubeOf(link: SongLink | null, songVideo: string | null): { id: string; start: number | null } | null {
  if (link?.service === "YOUTUBE" && link.value) return { id: link.value, start: link.startSeconds };
  return songVideo ? { id: songVideo, start: null } : null;
}

/** The reference recording the set's version plays along to (issue #346), when the viewer sees it. */
function useVersionReference(songVersionId: string | null, linkId: string | null): SongLink | null {
  const [link, setLink] = useState<SongLink | null>(null);
  useEffect(() => {
    setLink(null);
    if (!songVersionId || !linkId) return;
    let live = true;
    apiClient.listSongLinks(songVersionId).then(
      (links) => live && setLink(links.find((one) => one.id === linkId) ?? null),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [songVersionId, linkId]);
  return link;
}
