import { ApiError, cueSectionsOf, keptSetSong, onlineOrKept, transposeKey, type Attachment, type SetlistSongView } from "@songverse/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MetronomeSongButton } from "#/components/metronome";
import { PlayerChart } from "#/components/player-chart";
import { SyncControl } from "#/components/sync-control";
import { StemDock } from "#/components/stem-dock";
import { YouTubeDock } from "#/components/youtube-dock";
import { fileLoader, songFiles } from "#/lib/song-files";
import { ChartOrPdf, setSongViewStore } from "#/components/chart-or-pdf";
import { stemFilesOf, useChosenMultitrack } from "#/lib/stem-engine";
import { Badge } from "@songverse/ui/components/badge";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { useMode } from "#/lib/mode";
import { deviceStorage, useKeepSet } from "#/lib/offline-data";
import { setlistTitle, transposeLabel } from "#/lib/setlists";
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
          <h1 className="text-2xl font-semibold">{song?.title ?? t("sets.hiddenSong")}</h1>
          <p className="text-sm text-muted-foreground">{details}</p>
          {view.sharedBy ? (
            <div>
              <Badge variant="muted">{t("sets.sharedBy", { name: view.sharedBy.displayName })}</Badge>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncControl setId={set.id} className="h-8" />
          {song ? (
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

      {song ? (
        <SetSongStems
          songVersionId={song.id}
          title={song.title}
          returnTo={`/sets/${set.id}/songs/${item.id}`}
          tempo={tempo}
          timeSignature={arrangement?.timeSignature ?? song.document.defaults.timeSignature}
          setlist={{ id: set.id, name: setlistTitle(set, t, i18n.language) }}
          songKey={song.key}
          // The key the set plays it in: its arrangement's, with the set's own transposition on top.
          targetKey={song.key ? transposeKey(song.key, (arrangement?.transposeSteps ?? 0) + item.transposeSteps) : null}
        />
      ) : null}

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

/**
 * Practice: the song's stems (issue #64), for someone who can open the song
 * itself - from the API, or from the device's copy when offline.
 */
function SetSongStems({
  songVersionId,
  title,
  returnTo,
  tempo,
  timeSignature,
  setlist,
  songKey,
  targetKey,
}: {
  songVersionId: string;
  title: string;
  returnTo: string;
  /** The set: a multitrack recorded for it is what plays here by default (issue #127), and one recorded here can be its. */
  setlist: { id: string; name: string };
  /** The song's key, and the one the set plays it in: the stems are transposed to it by default (issue #129). */
  songKey: string | null | undefined;
  targetKey: string | null;
  /** The version's, for the metronome with the recording (issue #100). */
  tempo: number | null | undefined;
  timeSignature: { numerator: number; denominator: number } | null | undefined;
}) {
  const { mode } = useMode();
  // Chosen for the song in this set: the set's own multitrack by default.
  const choiceKey = `${songVersionId}@${setlist.id}`;
  const chosen = useChosenMultitrack(choiceKey);
  // Bumped when a part's recorded here, to list the files again.
  const [reload, setReload] = useState(0);
  const [files, setFiles] = useState<{ attachments: Attachment[]; offline: boolean; youtubeId: string | null; cueSections?: ReturnType<typeof cueSectionsOf> }>({ attachments: [], offline: false, youtubeId: null });

  useEffect(() => {
    if (mode !== "practice") return;
    let cancelled = false;
    Promise.all([songFiles(songVersionId), apiClient.getSongVersion(songVersionId).catch(() => null)])
      .then(([files, version]) => ({
        ...files,
        youtubeId: version?.identifiers.find((identifier) => identifier.type === "YOUTUBE")?.value ?? null,
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
  }, [mode, songVersionId, reload]);

  const playable = stemFilesOf(files.attachments, chosen, setlist.id);
  if (mode !== "practice") return null;
  // No audio of its own: its YouTube video, if it has one (issue #66).
  if (playable.stems.length === 0) {
    return files.youtubeId ? <YouTubeDock video={{ songVersionId, videoId: files.youtubeId, title, returnTo }} /> : null;
  }
  return (
    <StemDock
      song={{
        songVersionId,
        title,
        returnTo,
        ...playable,
        load: fileLoader(songVersionId, files.offline),
        choiceKey,
        songKey,
        targetKey,
        record: files.offline ? undefined : { attachments: files.attachments, setlist, onSaved: () => setReload((n) => n + 1) },
        tempo,
        timeSignature,
        cueSections: files.cueSections,
      }}
    />
  );
}
