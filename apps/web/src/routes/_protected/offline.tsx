import {
  allKeptSets,
  allKeptSongbooks,
  allKeptSongs,
  keptFile,
  lastOfflineSync,
  offlinePins,
  type OfflinePin,
  type OfflineSyncResult,
} from "@songverse/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { timeAgo } from "#/components/offline-banner";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { formatBytes } from "#/lib/format-bytes";
import { deleteOffline, forgetOffline, keysOffline } from "#/lib/offline-db";
import { deviceStorage, offlineDays, onOfflineSync, setOfflineDays, syncOffline } from "#/lib/offline-data";
import { formatSetDate, setlistTitle } from "#/lib/setlists";

/**
 * What this device keeps to work offline, and the space it takes (issue
 * #52): when it last caught up, persistent storage, how far ahead sets are
 * kept, and a way to free each set, songbook and song.
 */
export const Route = createFileRoute("/_protected/offline")({
  component: OfflineStoragePage,
});

const DAY_CHOICES = [3, 7, 14, 21, 30, 60];

interface Row {
  id: string;
  label: string;
  detail: string;
  bytes: number;
  /** Why it's kept: pinned can be unpinned, opened can be removed, upcoming comes back anyway. */
  reason: "pinned" | "upcoming" | "opened" | "own";
}

interface Summary {
  lastSync: OfflineSyncResult | undefined;
  sets: Row[];
  songbooks: Row[];
  songs: { count: number; pinned: Row[]; bytes: number };
  files: { count: number; bytes: number };
  usage: { used: number; quota: number } | null;
  persisted: boolean | null;
}

const size = (value: unknown) => new Blob([JSON.stringify(value)]).size;

function OfflineStoragePage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { session, offline } = Route.useRouteContext();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [days, setDays] = useState(offlineDays);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const storage = deviceStorage();
    const [lastSync, sets, songbooks, songs, pins, fileIds] = await Promise.all([
      lastOfflineSync(storage),
      allKeptSets(storage),
      allKeptSongbooks(storage),
      allKeptSongs(storage),
      offlinePins(storage),
      keysOffline("files"),
    ]);
    const pinned = (kind: OfflinePin["kind"], id: string) => pins.some((pin) => pin.kind === kind && pin.targetId === id);
    const today = new Date();
    const from = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
    const to = new Date(today.getTime() + offlineDays() * 86_400_000).toISOString().slice(0, 10);
    let fileBytes = 0;
    for (const id of fileIds) fileBytes += (await keptFile<Blob>(storage, id))?.size ?? 0;
    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    setSummary({
      lastSync,
      sets: sets.map(({ set, songs: views, ...copy }) => ({
        id: set.id,
        label: setlistTitle(set, t, i18n.language),
        detail: [set.name && set.eventDate ? formatSetDate(set.eventDate, i18n.language) : null, t("offline.songCount", { count: views.length })].filter(Boolean).join(" · "),
        bytes: size({ set, views, ...copy }),
        reason: pinned("SET", set.id) ? "pinned" : set.eventDate && set.eventDate >= from && set.eventDate <= to ? "upcoming" : "opened",
      })),
      songbooks: songbooks.map((copy) => ({
        id: copy.songbook.id,
        label: copy.songbook.name,
        detail: t("offline.songCount", { count: copy.songbook.entries.length }),
        bytes: size(copy),
        reason: "pinned",
      })),
      songs: {
        count: songs.length,
        bytes: songs.reduce((total, copy) => total + size(copy), 0),
        pinned: songs
          .filter((copy) => pinned("SONG", copy.song.id))
          .map((copy) => ({ id: copy.song.id, label: copy.song.title, detail: "", bytes: size(copy), reason: "pinned" })),
      },
      files: { count: fileIds.length, bytes: fileBytes },
      usage: estimate?.usage !== undefined && estimate.quota !== undefined ? { used: estimate.usage, quota: estimate.quota } : null,
      persisted: (await navigator.storage?.persisted?.().catch(() => null)) ?? null,
    });
  }, [t, i18n.language]);

  useEffect(() => {
    void load();
    return onOfflineSync(() => void load());
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    await syncOffline(session.userId);
    setSyncing(false);
  }

  async function remove(kind: "SET" | "SONG" | "SONGBOOK", row: Row) {
    if (row.reason === "pinned") await apiClient.unpinOffline(kind, row.id);
    await deleteOffline(kind === "SET" ? "sets" : kind === "SONG" ? "songs" : "songbooks", row.id);
    await load();
    void syncOffline(session.userId);
  }

  const reasonLabel = (row: Row) => t(`offline.reason.${row.reason}`);
  const list = (kind: "SET" | "SONG" | "SONGBOOK", rows: Row[], testId: string) =>
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t("offline.nothingKept")}</p>
    ) : (
      <ul className="flex flex-col divide-y" data-testid={testId}>
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{row.label}</span>
              <span className="text-xs text-muted-foreground">{[reasonLabel(row), row.detail, formatBytes(row.bytes)].filter(Boolean).join(" · ")}</span>
            </div>
            {row.reason === "upcoming" ? null : (
              <Button variant="outline" size="sm" disabled={!!offline} onClick={() => void remove(kind, row)}>
                {t("offline.remove")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("offline.storageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("offline.storageDescription")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("offline.thisDevice")}</CardTitle>
          <CardDescription>
            {summary?.lastSync ? t("offline.lastSync", { when: timeAgo(summary.lastSync.at, i18n.language) }) : t("offline.neverSynced")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" disabled={!!offline || syncing} onClick={() => void syncNow()}>
              <RefreshCw className={syncing ? "animate-spin" : undefined} />
              {t("offline.syncNow")}
            </Button>
            {summary?.usage ? <span className="text-muted-foreground">{t("offline.usage", { used: formatBytes(summary.usage.used), quota: formatBytes(summary.usage.quota) })}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {summary?.persisted ? (
              <span className="text-muted-foreground">{t("offline.persisted")}</span>
            ) : (
              <>
                <span className="text-muted-foreground">{t("offline.notPersisted")}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void navigator.storage?.persist?.().then(() => load())}
                  disabled={summary?.persisted === null}
                >
                  {t("offline.persist")}
                </Button>
              </>
            )}
          </div>
          <label className="flex flex-wrap items-center gap-2">
            {t("offline.daysLabel")}
            <NativeSelect
              value={String(days)}
              onChange={(event) => {
                const next = Number(event.target.value);
                setDays(next);
                setOfflineDays(next);
                void syncOffline(session.userId);
              }}
              className="w-auto"
            >
              {DAY_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {t("offline.days", { count: choice })}
                </option>
              ))}
            </NativeSelect>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("nav.sets")}</CardTitle>
          <CardDescription>{t("offline.setsHint")}</CardDescription>
        </CardHeader>
        <CardContent>{summary ? list("SET", summary.sets, "offline-sets") : null}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("nav.songbooks")}</CardTitle>
          <CardDescription>{t("offline.songbooksHint")}</CardDescription>
        </CardHeader>
        <CardContent>{summary ? list("SONGBOOK", summary.songbooks, "offline-songbooks") : null}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("offline.songsTitle")}</CardTitle>
          <CardDescription>
            {summary
              ? t("offline.songsSummary", {
                  count: summary.songs.count,
                  size: formatBytes(summary.songs.bytes),
                  files: summary.files.count,
                  filesSize: formatBytes(summary.files.bytes),
                })
              : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {summary ? list("SONG", summary.songs.pinned, "offline-songs") : null}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void forgetOffline().then(async () => {
                  // The session comes back with the next page; the rest with the next sync.
                  await router.invalidate();
                  await load();
                })
              }
            >
              {t("offline.removeAll")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t("offline.privacy")}</p>
    </div>
  );
}
