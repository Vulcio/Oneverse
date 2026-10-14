import type { JobSummary, JobsStatus } from "@songverse/core";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@songverse/ui/components/confirm-button";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { apiClient } from "#/lib/api-client";

/** How long ago, for a heartbeat: seconds, then minutes. */
function ago(at: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/**
 * Background jobs (issue #92): whether the Worker is running (its
 * heartbeat), each queue's jobs, and the last ones done - the backfills'
 * results among them. Refreshed every few seconds while it's shown.
 */
export function BackgroundJobsCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<JobsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);

  const load = useCallback(() => {
    apiClient
      .getJobsStatus()
      .then((next) => {
        setStatus(next);
        setError(null);
        setNow(Date.now());
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  /** What a job did, in words. */
  function outcome(job: JobSummary): string {
    if (job.state === "failed") return t("jobs.failed", { error: job.error ?? "?" });
    const result = job.result as Record<string, unknown> | null;
    // A backfill's lookups that failed are tried again next time (issue #93).
    const notLookedUp = Number(result?.failed ?? 0) > 0 ? ` ${t("jobs.notLookedUp", { count: Number(result?.failed) })}` : "";
    switch (job.name) {
      case "artwork-backfill":
        return t("artwork.backfilled", result ?? { tried: 0, found: 0 }) + notLookedUp;
      case "artist-backfill":
        return t("artistSettings.backfilled", result ?? { tried: 0, found: 0 }) + notLookedUp;
      case "artwork": {
        // Issue #93's outcome; before it, a found flag.
        const said = (result?.outcome as string | undefined) ?? (result?.found ? "found" : "nomatch");
        return said === "found" ? t("jobs.found") : said === "failed" ? t("jobs.lookupFailed") : said === "skipped" ? t("jobs.skipped") : t("jobs.notFound");
      }
      case "artist":
        return result
          ? t(result.failed ? "jobs.artistFailed" : "jobs.artistFound", { picture: result.picture ? t("jobs.yes") : t("jobs.no"), bios: Number(result.bios ?? 0) })
          : t("jobs.alreadyLookedUp");
      default:
        return t("jobs.done");
    }
  }

  return (
    <Card data-testid="background-jobs">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          {t("jobs.title")}
          <Button variant="ghost" size="icon" aria-label={t("jobs.refresh")} onClick={load}>
            <RefreshCw />
          </Button>
        </CardTitle>
        <CardDescription>{t("jobs.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {status ? (
          <>
            <div className="flex flex-col gap-1 text-sm" data-testid="jobs-runner">
              {status.worker ? (
                <p>{t("jobs.workerSeen", { ago: ago(status.worker.at, now), host: status.worker.host })}</p>
              ) : (
                <p className={status.api ? "text-muted-foreground" : "text-destructive"}>{t("jobs.workerMissing")}</p>
              )}
              {status.thisApiRunsJobs ? <p className="text-muted-foreground">{t("jobs.apiRuns")}</p> : null}
              {status.worker?.settingsKey === "missing" || status.worker?.settingsKey === "different" ? (
                <p className="text-destructive" data-testid="worker-settings-key">
                  {t(status.worker.settingsKey === "missing" ? "jobs.workerKeyMissing" : "jobs.workerKeyDifferent")}
                </p>
              ) : null}
              {/* Recorded takes need ffmpeg where the jobs run (issue #127). */}
              {(() => {
                const ffmpeg = (status.worker ?? status.api)?.ffmpeg;
                if (ffmpeg === null || ffmpeg === undefined) return null;
                return ffmpeg ? (
                  <p className="text-muted-foreground" data-testid="jobs-ffmpeg">
                    {t("jobs.ffmpeg", { version: ffmpeg })}
                  </p>
                ) : (
                  <p className="text-destructive" data-testid="jobs-ffmpeg">
                    {t("jobs.ffmpegMissing")}
                  </p>
                );
              })()}
            </div>
            <ul className="flex flex-col divide-y rounded-md border text-sm">
              {status.queues.map((queue) => (
                <li key={queue.name} className="flex flex-wrap items-baseline justify-between gap-2 p-3" data-testid={`queue-${queue.name}`}>
                  <span className="font-medium">{t(`jobs.queue_${queue.name}`, { defaultValue: queue.name })}</span>
                  <span className={queue.failed > 0 ? "text-destructive" : "text-muted-foreground"}>{t("jobs.counts", queue)}</span>
                </li>
              ))}
            </ul>
            {status.failed.length > 0 || status.failedWithoutDetails > 0 ? (
              <div className="flex flex-col gap-2" data-testid="jobs-failed">
                <p className="text-sm font-medium">{t("jobs.failedJobs")}</p>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {status.failed.map((job, index) => (
                    <li key={`${job.queue}-${job.name}-${job.finishedAt}-${index}`} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">
                        {t(`jobs.job_${job.name}`, { defaultValue: job.name })}
                        {job.subject ? ` · ${job.subject}` : ""}
                      </span>
                      <span className="break-all text-destructive">{outcome(job)}</span>
                      {job.finishedAt ? <span className="text-xs text-muted-foreground">{new Date(job.finishedAt).toLocaleString()}</span> : null}
                    </li>
                  ))}
                </ul>
                {status.failedWithoutDetails > 0 ? (
                  <p className="text-sm text-muted-foreground">{t("jobs.failedWithoutDetails", { count: status.failedWithoutDetails })}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <ConfirmButton
                    label={t("jobs.clearFailed")}
                    confirmLabel={t("jobs.clearFailedConfirm")}
                    busyLabel={t("admin.running")}
                    cancelLabel={t("admin.cancel")}
                    busy={clearing}
                    onConfirm={async () => {
                      setClearing(true);
                      try {
                        const { cleared: count } = await apiClient.clearFailedJobs();
                        setCleared(t("jobs.cleared", { count }));
                        load();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      } finally {
                        setClearing(false);
                      }
                    }}
                  />
                </div>
              </div>
            ) : null}
            {cleared ? (
              <p className="text-sm text-muted-foreground" role="status">
                {cleared}
              </p>
            ) : null}
            {/* The scheduled jobs, run now besides their schedule (issue #235). */}
            <div className="flex flex-col gap-2" data-testid="jobs-scheduled">
              <p className="text-sm font-medium">{t("jobs.scheduled")}</p>
              <p className="text-xs text-muted-foreground">{t("jobs.scheduledHint")}</p>
              <ul className="flex flex-col gap-1.5 text-sm">
                {(["make-event-sets", "event-reminders", "clean-up-notifications"] as const).map((name) => (
                  <li key={name} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{t(`jobs.job_${name}`)}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void apiClient.runScheduledJob(name).then(
                          () => {
                            setCleared(t("jobs.runQueued", { name: t(`jobs.job_${name}`) }));
                            load();
                          },
                          (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
                        )
                      }
                      data-testid={`run-${name}`}
                    >
                      {t("jobs.runNow")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{t("jobs.recent")}</p>
              {status.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("jobs.noRecent")}</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm" data-testid="jobs-recent">
                  {status.recent.map((job, index) => (
                    <li key={`${job.queue}-${job.name}-${job.finishedAt}-${index}`} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">
                        {t(`jobs.job_${job.name}`, { defaultValue: job.name })}
                        {job.subject ? ` · ${job.subject}` : ""}
                      </span>
                      <span className={job.state === "failed" ? "text-destructive" : "text-muted-foreground"}>{outcome(job)}</span>
                      {job.finishedAt ? <span className="text-xs text-muted-foreground">{new Date(job.finishedAt).toLocaleString()}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
