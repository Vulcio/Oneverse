import { formatDuration, splitNames, type SongbookSongInfo, type SongInfoField, type SongInfoRefreshView, type SongInfoValue, type UpdateSongVersionInput } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { RefreshCw, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { cn } from "@oneverse/ui/lib/utils";
import { apiClient } from "#/lib/api-client";

/** The columns edited in place, and how each is sent. */
const COLUMNS = ["title", "artists", "album", "year", "key", "tempo", "timeSignature", "ccli", "copyright"] as const;
type Column = (typeof COLUMNS)[number];

const cellText = (song: SongbookSongInfo, column: Column): string => {
  const value = song[column];
  if (Array.isArray(value)) return value.join(", ");
  return value === null || value === undefined ? "" : String(value);
};

/** A cell's text as the song's update takes it: empty clears it. */
function changeOf(column: Column, text: string): UpdateSongVersionInput | null {
  const value = text.trim();
  switch (column) {
    case "title":
      return value ? { title: value } : null;
    case "artists": {
      const names = splitNames(value);
      return names.length ? { artists: names } : null;
    }
    case "year":
    case "tempo":
      if (value && !/^\d+$/.test(value)) return null;
      return { [column]: value ? Number(value) : null };
    default:
      return { [column]: value || null };
  }
}

/**
 * A songbook's songs and their details in one table (issue #353), edited in
 * place: a cell is saved when it's left. A catalogue song the viewer can't
 * change gets a suggestion instead (issue #74), for its editors to take.
 */
export function SongbookSongInfoCard({ songbookId }: { songbookId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [songs, setSongs] = useState<SongbookSongInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Each load starts the cells over (their text is the song's as loaded).
  const [loads, setLoads] = useState(0);
  const [rowState, setRowState] = useState<Record<string, { kind: "saving" | "saved" | "suggested" | "error"; text?: string }>>({});

  async function load() {
    setFailed(false);
    try {
      setSongs(await apiClient.getSongbookSongInfo(songbookId));
      setLoads((n) => n + 1);
    } catch {
      setFailed(true);
    }
  }
  useEffect(() => {
    if (open) void load();
  }, [open, songbookId]);

  async function save(song: SongbookSongInfo, column: Column, text: string) {
    if (text.trim() === cellText(song, column).trim()) return;
    const change = changeOf(column, text);
    if (!change) {
      setRowState((s) => ({ ...s, [song.songVersionId]: { kind: "error", text: t("songbooks.songInfoInvalid", { field: t(`songbooks.songInfoColumns.${column}`) }) } }));
      return;
    }
    setRowState((s) => ({ ...s, [song.songVersionId]: { kind: "saving" } }));
    try {
      if (song.canEdit) {
        const saved = await apiClient.updateSongVersion(song.songVersionId, { ...change, revision: song.revision });
        setSongs((list) => list && list.map((s) => (s.songVersionId === song.songVersionId ? { ...s, ...fromSaved(s, column, text), revision: saved.documentJson.revision } : s)));
        setRowState((s) => ({ ...s, [song.songVersionId]: { kind: "saved" } }));
      } else {
        await apiClient.suggestChange(song.songVersionId, { ...change, revision: song.revision, message: t("songbooks.songInfoSuggestionMessage") });
        setRowState((s) => ({ ...s, [song.songVersionId]: { kind: "suggested" } }));
      }
    } catch (err) {
      setRowState((s) => ({ ...s, [song.songVersionId]: { kind: "error", text: err instanceof Error && err.message ? err.message : t("songbooks.songInfoSaveFailed") } }));
    }
  }

  return (
    <Card data-testid="songbook-song-info">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Table2 className="size-4 text-primary" aria-hidden />
            {t("songbooks.songInfo")}
          </CardTitle>
          <CardDescription>{t("songbooks.songInfoDescription")}</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t("songbooks.songInfoHide") : t("songbooks.songInfoShow")}
        </Button>
      </CardHeader>
      {open ? (
        <CardContent className="flex flex-col gap-6">
          {failed ? (
            <p className="text-sm text-destructive" role="alert">
              {t("songbooks.songInfoLoadFailed")}
            </p>
          ) : !songs ? (
            <p className="text-sm text-muted-foreground">{t("songbooks.songInfoLoading")}</p>
          ) : songs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("songbooks.songInfoEmpty")}</p>
          ) : (
            <div className="max-h-[32rem] overflow-auto rounded-md border">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="sticky top-0 z-10 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-2 py-2 font-medium">#</th>
                    {COLUMNS.map((column) => (
                      <th key={column} className="px-2 py-2 font-medium">
                        {t(`songbooks.songInfoColumns.${column}`)}
                      </th>
                    ))}
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {songs.map((song) => {
                    const state = rowState[song.songVersionId];
                    const editable = song.canEdit || song.canSuggest;
                    return (
                      <tr key={`${song.entryId}-${loads}`} data-testid="song-info-row" data-song={song.songVersionId}>
                        <td className="px-2 py-1 text-xs text-muted-foreground tabular-nums">{song.entryCode ?? ""}</td>
                        {COLUMNS.map((column) => (
                          <td key={column} className="px-1 py-1">
                            <Input
                              aria-label={`${t(`songbooks.songInfoColumns.${column}`)} - ${song.title}`}
                              defaultValue={cellText(song, column)}
                              disabled={!editable}
                              onBlur={(event) => void save(song, column, event.target.value)}
                              className={cn("h-8 min-w-0 text-sm", column === "title" || column === "copyright" ? "w-48" : column === "artists" || column === "album" ? "w-36" : "w-20")}
                            />
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-2 py-1 text-xs">
                          <Link to="/library/$songVersionId" params={{ songVersionId: song.songVersionId }} className="text-primary hover:underline">
                            {t("songbooks.songInfoOpen")}
                          </Link>
                          {state ? (
                            <span
                              className={cn("ml-2", state.kind === "error" ? "text-destructive" : "text-muted-foreground")}
                              role={state.kind === "error" ? "alert" : "status"}
                              data-testid="song-info-row-state"
                            >
                              {state.kind === "error" ? state.text : t(`songbooks.songInfoState.${state.kind}`)}
                            </span>
                          ) : !song.canEdit && song.canSuggest ? (
                            <span className="ml-2 text-muted-foreground">{t("songbooks.songInfoSuggests")}</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <SongInfoRefreshPanel songbookId={songbookId} onApplied={() => void load()} />
        </CardContent>
      ) : null}
    </Card>
  );
}

/** The row as saved, for the next change's comparison. */
function fromSaved(song: SongbookSongInfo, column: Column, text: string): Partial<SongbookSongInfo> {
  const value = text.trim();
  if (column === "artists") return { artists: splitNames(value) };
  if (column === "year" || column === "tempo") return { [column]: value ? Number(value) : null };
  return { [column]: column === "title" ? value || song.title : value || null };
}

function shown(field: SongInfoField, value: SongInfoValue, t: (key: string) => string): string {
  if (value === null || value === false) return t("songEditor.infoEmpty");
  if (field === "artwork") return value === true ? t("songEditor.infoOwnImage") : "";
  if (Array.isArray(value)) return value.join(", ");
  if (field === "duration" && typeof value === "number") return formatDuration(value);
  return String(value);
}

/**
 * Bring the songbook up to date (issue #353): every song looked up again
 * by the Worker, then each one's changes to review - the empty fields
 * ticked, what a song has only if ticked - and used in one pass.
 */
function SongInfoRefreshPanel({ songbookId, onApplied }: { songbookId: string; onApplied: () => void }) {
  const { t } = useTranslation();
  const [refresh, setRefresh] = useState<SongInfoRefreshView | null>(null);
  const [chosen, setChosen] = useState<Record<string, Set<SongInfoField>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const take = (view: SongInfoRefreshView) => {
    setRefresh(view);
    setChosen(Object.fromEntries(view.songs.map((song) => [song.songVersionId, new Set(song.proposals.filter((p) => p.fillsEmpty).map((p) => p.field))])));
  };

  useEffect(() => {
    void apiClient.latestSongInfoRefresh(songbookId).then(({ refresh: last }) => last && take(last)).catch(() => undefined);
  }, [songbookId]);

  const running = refresh?.status === "queued" || refresh?.status === "running";
  useEffect(() => {
    if (!running || !refresh) return;
    const timer = setInterval(() => {
      void apiClient.getSongInfoRefresh(songbookId, refresh.id).then(take).catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [running, refresh?.id, songbookId]);

  const reviewable = useMemo(() => (refresh && !running ? refresh.songs.filter((song) => song.canEdit && song.proposals.length > 0) : []), [refresh, running]);
  const notFound = refresh && !running ? refresh.songs.filter((song) => song.outcome !== "found").length : 0;
  const ticked = reviewable.reduce((sum, song) => sum + (chosen[song.songVersionId]?.size ?? 0), 0);

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      take(await apiClient.startSongInfoRefresh(songbookId));
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error && err.message ? err.message : t("songbooks.refreshFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!refresh) return;
    const songs = reviewable.map((song) => ({ songVersionId: song.songVersionId, fields: [...(chosen[song.songVersionId] ?? [])] })).filter((song) => song.fields.length > 0);
    if (!songs.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiClient.applySongInfoRefresh(songbookId, refresh.id, { songs });
      take(await apiClient.getSongInfoRefresh(songbookId, refresh.id));
      setMessage({ kind: "ok", text: t("songbooks.refreshApplied", { count: result.applied.length }) });
      onApplied();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error && err.message ? err.message : t("songbooks.refreshFailed") });
    } finally {
      setBusy(false);
    }
  }

  const toggle = (songVersionId: string, field: SongInfoField, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current[songVersionId] ?? []);
      if (on) next.add(field);
      else next.delete(field);
      return { ...current, [songVersionId]: next };
    });

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="song-info-refresh-title" data-testid="song-info-refresh">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="song-info-refresh-title" className="text-sm font-semibold">
            {t("songbooks.refresh")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("songbooks.refreshDescription")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void start()} disabled={busy || running}>
          <RefreshCw className={cn(running && "animate-spin")} />
          {running ? t("songbooks.refreshRunning", { done: refresh!.done, total: refresh!.total }) : t("songbooks.refreshStart")}
        </Button>
      </div>
      {message ? (
        <p className={cn("text-sm", message.kind === "error" ? "text-destructive" : "text-muted-foreground")} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
      {refresh && !running ? (
        <>
          <p className="text-xs text-muted-foreground" data-testid="song-info-refresh-summary">
            {t("songbooks.refreshSummary", { changed: reviewable.length, total: refresh.total, notFound })}
          </p>
          {reviewable.length > 0 ? (
            <>
              <ul className="flex max-h-[28rem] flex-col gap-2 overflow-auto">
                {reviewable.map((song) => (
                  <li key={song.songVersionId} className="rounded-md border p-2.5" data-testid="song-info-refresh-song">
                    <p className="text-sm font-medium">
                      {song.entryCode ? <span className="mr-2 text-muted-foreground tabular-nums">{song.entryCode}</span> : null}
                      {song.title}
                    </p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {song.proposals.map((proposal) => {
                        const id = `refresh-${song.songVersionId}-${proposal.field}`;
                        return (
                          <li key={proposal.field} className="flex items-start gap-2 text-sm" data-field={proposal.field}>
                            <input
                              id={id}
                              type="checkbox"
                              className="mt-1 size-4 shrink-0 accent-primary"
                              checked={chosen[song.songVersionId]?.has(proposal.field) ?? false}
                              onChange={(event) => toggle(song.songVersionId, proposal.field, event.target.checked)}
                            />
                            <label htmlFor={id} className="min-w-0">
                              <span className="text-xs text-muted-foreground">{proposal.field === "artwork" ? t("songEditor.artwork") : t(`songEditor.fields.${proposal.field}`)}: </span>
                              <span className={cn(!proposal.fillsEmpty && "text-amber-700 dark:text-amber-400")}>{shown(proposal.field, proposal.current, t)}</span>
                              <span aria-hidden> → </span>
                              <span className="sr-only">{t("songbooks.refreshBecomes")}</span>
                              {proposal.field === "artwork" && song.match?.thumbnailUrl ? (
                                <img src={song.match.thumbnailUrl} alt="" className="inline size-8 rounded object-cover align-middle" loading="lazy" referrerPolicy="no-referrer" />
                              ) : (
                                <span className="font-medium">{shown(proposal.field, proposal.proposed, t)}</span>
                              )}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => void apply()} disabled={busy || ticked === 0}>
                  {t("songbooks.refreshApply", { count: ticked })}
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
