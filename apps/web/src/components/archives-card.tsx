import type { ArchiveImportSummary, ArchiveOwnerRef, ContentArchive } from "@oneverse/core";
import { Archive, Download, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";

const KINDS = ["songs", "arrangements", "songbooks", "sets", "notes", "files"] as const;

function megabytes(bytes: number | null): string {
  if (!bytes) return "";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImportSummary(value: ContentArchive["summary"]): value is ArchiveImportSummary {
  return !!value && typeof value === "object" && "created" in value;
}

/**
 * Backups for people (issue #351): an archive of everything its owner owns -
 * yours, or a team's or an organisation's for their admins - made now or
 * every week, downloaded, and imported back. An import never changes what's
 * already there: what's the same is used as it is, the rest comes in anew.
 */
export function ArchivesCard({ owner }: { owner: ArchiveOwnerRef }) {
  const { t, i18n } = useTranslation();
  const [weekly, setWeekly] = useState(false);
  const [archives, setArchives] = useState<ContentArchive[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const key = JSON.stringify(owner);

  const load = useCallback(() => {
    return apiClient.listArchives(JSON.parse(key) as ArchiveOwnerRef).then(
      (result) => {
        setWeekly(result.weekly);
        setArchives(result.archives);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, [key]);

  useEffect(() => void load(), [load]);
  // While one's being made or imported, look again every few seconds.
  const going = archives?.some((archive) => archive.status === "PENDING" || archive.status === "RUNNING");
  useEffect(() => {
    if (!going) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [going, load]);

  const act = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void work()
      .then(load, (err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  const counts = (summary: Record<string, number>) =>
    KINDS.filter((kind) => summary[kind])
      .map((kind) => t(`archives.count.${kind}`, { count: summary[kind] }))
      .join(", ") || t("archives.empty");

  return (
    <Card data-testid="archives-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Archive className="size-4" aria-hidden />
          {t("archives.title")}
        </CardTitle>
        <CardDescription>{t(`archives.description.${owner.scope}`)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" disabled={busy || going} onClick={() => act(() => apiClient.makeArchive(owner))} data-testid="archive-make">
            {t("archives.make")}
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={weekly}
              disabled={busy || archives === null}
              onChange={(event) => {
                const next = event.target.checked;
                setWeekly(next);
                act(() => apiClient.setArchiveSchedule(owner, next));
              }}
              data-testid="archive-weekly"
            />
            {t("archives.weekly")}
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{t("archives.kept")}</p>

        {archives && archives.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-md border text-sm" data-testid="archive-list">
            {archives.map((archive) => (
              <li key={archive.id} className="flex flex-col gap-1 px-3 py-2" data-testid="archive-row" data-kind={archive.kind} data-status={archive.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {archive.kind === "EXPORT" ? t(archive.trigger === "WEEKLY" ? "archives.weeklyArchive" : "archives.archive") : t("archives.imported", { name: archive.filename ?? "" })}
                  </span>
                  <span className="text-muted-foreground">{when(archive.createdAt)}</span>
                  {archive.kind === "EXPORT" && archive.sizeBytes ? <span className="text-muted-foreground">{megabytes(archive.sizeBytes)}</span> : null}
                  <span className="ml-auto flex items-center gap-1">
                    {archive.downloadPath ? (
                      <Button size="sm" variant="outline" render={<a href={apiClient.archiveDownloadUrl(archive.downloadPath)} download={archive.filename ?? undefined} data-testid="archive-download" />}>
                        <Download className="size-4" aria-hidden />
                        {t("archives.download")}
                      </Button>
                    ) : null}
                    {archive.status !== "RUNNING" ? (
                      <Button type="button" size="icon" variant="ghost" aria-label={t("archives.delete")} disabled={busy} onClick={() => act(() => apiClient.deleteArchive(archive.id))} data-testid="archive-delete">
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </span>
                </div>
                <ArchiveStatus archive={archive} counts={counts} />
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="text-sm">{t("archives.importHint")}</p>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) act(() => apiClient.importArchive(owner, file, file.name));
            }}
            data-testid="archive-import-input"
          />
          <div>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()} data-testid="archive-import">
              <Upload className="size-4" aria-hidden />
              {t("archives.import")}
            </Button>
          </div>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ArchiveStatus({ archive, counts }: { archive: ContentArchive; counts: (summary: Record<string, number>) => string }) {
  const { t } = useTranslation();
  if (archive.status === "PENDING" || archive.status === "RUNNING") {
    return <p className="text-muted-foreground" data-testid="archive-status">{t(archive.kind === "EXPORT" ? "archives.making" : "archives.importing")}</p>;
  }
  if (archive.status === "FAILED") {
    return (
      <p className="text-destructive" data-testid="archive-status">
        {t("archives.failed", { error: archive.error ?? "" })}
      </p>
    );
  }
  if (archive.kind === "EXPORT") {
    const summary = archive.summary && !isImportSummary(archive.summary) ? archive.summary : {};
    return (
      <p className="text-muted-foreground" data-testid="archive-status">
        {counts(summary)}
        {archive.downloadPath ? "" : ` · ${t("archives.expired")}`}
      </p>
    );
  }
  if (!isImportSummary(archive.summary)) return null;
  const { created, kept, leftOut, leftOutCount } = archive.summary;
  const keptCount = Object.values(kept).reduce((sum, n) => sum + n, 0);
  return (
    <div className="flex flex-col gap-1 text-muted-foreground" data-testid="archive-status">
      <p>{t("archives.created", { what: counts(created) })}</p>
      {created.teams ? <p>{t("archives.createdTeams", { count: created.teams })}</p> : null}
      {keptCount ? <p data-testid="archive-kept">{t("archives.keptAsIs", { what: counts(kept) })}</p> : null}
      {leftOutCount ? (
        <details data-testid="archive-left-out">
          <summary className="cursor-pointer">{t("archives.leftOut", { count: leftOutCount })}</summary>
          <ul className="ml-4 list-disc">
            {leftOut.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
