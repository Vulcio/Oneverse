import {
  detailChanges,
  diffHunks,
  diffLines,
  formatDuration,
  getLanguageDisplayName,
  sectionsToChordPro,
  type SongRevisionDetail,
  type SongRevisionEntry,
  type SongSnapshot,
} from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { History, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { chartOfSections, SongChart } from "#/components/song-chart";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { cn } from "@oneverse/ui/lib/utils";

/**
 * The song's history (issue #71): each save, newest first, with who and
 * when; one opened shows what it changed - its details, credits and the
 * chart's lines - and, for editors, Restore, which saves the song as that
 * entry left it (itself a new entry).
 */
export function HistoryTab({
  songVersionId,
  updatedAt,
  canEdit,
  dirty,
}: {
  songVersionId: string;
  /** The song's, so the list follows its saves. */
  updatedAt: string;
  canEdit: boolean;
  /** Unsaved edits in the editor, which a restore would lose. */
  dirty: boolean;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [entries, setEntries] = useState<SongRevisionEntry[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SongRevisionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getSongHistory(songVersionId)
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        setSelectedId((current) => (current && list.some((entry) => entry.id === current) ? current : (list[0]?.id ?? null)));
      })
      .catch(() => !cancelled && setError(t("history.loadFailed")));
    return () => {
      cancelled = true;
    };
  }, [songVersionId, updatedAt, t]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetail(null);
    apiClient
      .getSongRevision(songVersionId, selectedId)
      .then((found) => !cancelled && setDetail(found))
      .catch(() => !cancelled && setError(t("history.loadFailed")));
    return () => {
      cancelled = true;
    };
  }, [songVersionId, selectedId, t]);

  const when = (date: string) => new Date(date).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  async function restore(entry: SongRevisionEntry) {
    setRestoring(true);
    setError(null);
    try {
      await apiClient.restoreSongRevision(songVersionId, entry.id);
      setSelectedId(null);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("history.restoreFailed"));
    } finally {
      setRestoring(false);
    }
  }

  if (entries === null) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{error ?? t("history.loading")}</p>;
  }
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("history.empty")}</CardContent>
      </Card>
    );
  }
  const current = entries[0]!;
  const selected = entries.find((entry) => entry.id === selectedId) ?? current;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card className="self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-primary" aria-hidden />
            {t("history.title")}
          </CardTitle>
          <CardDescription>{t("history.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="-mx-2 flex flex-col" aria-label={t("history.title")} data-testid="history-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                    entry.id === selected.id && "bg-muted",
                  )}
                  aria-current={entry.id === selected.id ? "true" : undefined}
                  onClick={() => setSelectedId(entry.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{summary(entry, t, when)}</span>
                    {entry.id === current.id ? <span className="text-xs font-medium text-primary">{t("history.current")}</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {[entry.author?.displayName, when(entry.kind === "BASELINE" ? entry.createdAt : entry.updatedAt)].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="min-w-0 self-start" data-testid="history-entry">
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>{summary(selected, t, when)}</CardTitle>
            <CardDescription>
              {selected.kind === "BASELINE"
                ? t("history.baselineHint")
                : [selected.author?.displayName, when(selected.updatedAt)].filter(Boolean).join(" · ")}
            </CardDescription>
          </div>
          {canEdit && selected.id !== current.id ? (
            <div className="flex flex-col items-end gap-1">
              <Button type="button" variant="outline" disabled={dirty || restoring} onClick={() => void restore(selected)}>
                <RotateCcw />
                {restoring ? t("history.restoring") : t("history.restore")}
              </Button>
              {dirty ? <span className="text-xs text-muted-foreground">{t("history.saveFirst")}</span> : null}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {detail && detail.id === selected.id ? <EntryChanges detail={detail} /> : <p className="text-sm text-muted-foreground">{t("history.loading")}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function summary(entry: SongRevisionEntry, t: (key: string, options?: Record<string, unknown>) => string, when: (date: string) => string): string {
  switch (entry.kind) {
    case "CREATED":
      return t("history.created");
    case "BASELINE":
      return t("history.baseline");
    case "RESTORED":
      return entry.restoredFrom ? t("history.restoredFrom", { date: when(entry.restoredFrom.updatedAt) }) : t("history.restored");
    default:
      return entry.changes.length > 0
        ? t("history.changed", { what: entry.changes.map((change) => t(`history.changes.${change}`)).join(t("history.and")) })
        : t("history.edited");
  }
}

/** What an entry changed from the one before; the first, the song as it was then. */
function EntryChanges({ detail }: { detail: SongRevisionDetail }) {
  if (!detail.previous) return <SnapshotView snapshot={detail.snapshot} />;
  return <SnapshotDiff before={detail.previous} after={detail.snapshot} />;
}

/**
 * What changed from `before` to `after`: details and credits struck out
 * and new, the chart's lines removed and added - and the whole song as it
 * is in `after`, on demand. A history entry, a suggestion (issue #74).
 */
export function SnapshotDiff({ before: previous, after: snapshot, showLabel }: { before: SongSnapshot; after: SongSnapshot; showLabel?: string }) {
  const { t } = useTranslation();
  const [wholeChart, setWholeChart] = useState(false);
  const details = detailChanges(previous, snapshot);
  const credits = creditLines(previous, snapshot);
  const chartDiff = diffHunks(diffLines(chartLines(previous), chartLines(snapshot)));
  // The order it's sung in, over the sections both have (a section added or removed shows in the lines).
  const both = new Set(previous.chart.sections.map((section) => section.id).filter((id) => snapshot.chart.sections.some((section) => section.id === id)));
  const order = (s: SongSnapshot) => s.chart.flow.map((item) => item.sectionId).filter((id) => both.has(id)).join();
  const orderChanged = order(previous) !== order(snapshot);
  const nothing = details.length === 0 && credits.length === 0 && chartDiff.length === 0 && !orderChanged;

  return (
    <>
      {nothing ? <p className="text-sm text-muted-foreground">{t("history.noChanges")}</p> : null}
      {details.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label={t("history.headings.details")}>
          <h3 className="text-sm font-medium">{t("history.headings.details")}</h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm" data-testid="history-details">
            {details.map((change) => (
              <FieldChange key={change.field} field={change.field} before={change.before} after={change.after} />
            ))}
          </dl>
        </section>
      ) : null}
      {credits.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label={t("history.headings.credits")}>
          <h3 className="text-sm font-medium">{t("history.headings.credits")}</h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            {credits.map((line) => (
              <div key={line.role} className="contents">
                <dt className="text-muted-foreground">{t(`songEditor.creditRoles.${line.role}`, { defaultValue: line.role })}</dt>
                <dd className="flex flex-wrap gap-x-2">
                  {line.before ? <del className="text-destructive">{line.before}</del> : null}
                  {line.after ? <ins className="text-green-700 no-underline dark:text-green-400">{line.after}</ins> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {chartDiff.length > 0 || orderChanged ? (
        <section className="flex flex-col gap-2" aria-label={t("history.headings.chart")}>
          <h3 className="text-sm font-medium">{t("history.headings.chart")}</h3>
          {orderChanged ? <p className="text-sm text-muted-foreground">{t("history.orderChanged")}</p> : null}
          {chartDiff.length > 0 ? (
            <pre className="overflow-x-auto rounded-md border bg-muted/40 py-2 font-mono text-xs leading-relaxed" data-testid="history-chart-diff">
              {chartDiff.map((line, index) =>
                line === null ? (
                  <div key={index} className="px-3 text-muted-foreground" aria-hidden>
                    ⋯
                  </div>
                ) : (
                  <div
                    key={index}
                    data-kind={line.kind}
                    className={cn(
                      "px-3",
                      line.kind === "added" && "bg-green-500/10 text-green-800 dark:text-green-300",
                      line.kind === "removed" && "bg-destructive/10 text-destructive line-through",
                    )}
                  >
                    <span className="sr-only">{line.kind === "added" ? t("history.added") : line.kind === "removed" ? t("history.removed") : ""}</span>
                    <span aria-hidden className="mr-2 inline-block w-3 select-none text-muted-foreground">
                      {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
                    </span>
                    {line.text || " "}
                  </div>
                ),
              )}
            </pre>
          ) : null}
        </section>
      ) : null}
      <div>
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => setWholeChart((open) => !open)} aria-expanded={wholeChart}>
          {wholeChart ? t("history.hideSong") : (showLabel ?? t("history.showSong"))}
        </Button>
      </div>
      {wholeChart ? <SnapshotView snapshot={snapshot} /> : null}
    </>
  );
}

/** A detail's value as the song page shows it. */
function formatField(field: string, value: string, locale: string): string {
  if (!value) return "";
  if (field === "language") return getLanguageDisplayName(value, locale);
  if (field === "durationSeconds") return formatDuration(Number(value));
  return value;
}

function FieldChange({ field, before, after }: { field: string; before: string; after: string }) {
  const { t, i18n } = useTranslation();
  const shown = (value: string) => formatField(field, value, i18n.language);
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{fieldLabel(field, t)}</dt>
      <dd className="flex min-w-0 flex-wrap gap-x-2">
        {before ? <del className="break-words text-destructive">{shown(before)}</del> : null}
        {after ? <ins className="break-words text-green-700 no-underline dark:text-green-400">{shown(after)}</ins> : <span className="text-muted-foreground">{t("history.cleared")}</span>}
      </dd>
    </div>
  );
}

function fieldLabel(field: string, t: (key: string) => string): string {
  if (field === "durationSeconds") return t("songEditor.fields.duration");
  if (field === "copyrightYear" || field === "publisher") return t(`history.fields.${field}`);
  return t(`songEditor.fields.${field}`);
}

/** The chart's lines, as the editor's text shows them. */
function chartLines(snapshot: SongSnapshot): string[] {
  return sectionsToChordPro(snapshot.chart.sections).trimEnd().split("\n");
}

/** Per role, who was credited before and after, where that changed. */
function creditLines(before: SongSnapshot, after: SongSnapshot): { role: string; before: string; after: string }[] {
  const roles = [...new Set([...before.credits, ...after.credits].flatMap((credit) => credit.roles))];
  const names = (snapshot: SongSnapshot, role: string) =>
    snapshot.credits
      .filter((credit) => credit.roles.includes(role))
      .map((credit) => credit.name)
      .join(", ");
  return roles.map((role) => ({ role, before: names(before, role), after: names(after, role) })).filter((line) => line.before !== line.after);
}

/** The song as an entry left it: its details, credits and chart. */
function SnapshotView({ snapshot }: { snapshot: SongSnapshot }) {
  const { t, i18n } = useTranslation();
  const chart = useMemo(
    () => chartOfSections(snapshot.chart.sections, snapshot.chart.flow, snapshot.chart.defaults.key ?? null),
    [snapshot],
  );
  const empty: SongSnapshot = { ...snapshot, details: Object.fromEntries(Object.keys(snapshot.details).map((key) => [key, null])) as never, chart: { ...snapshot.chart, defaults: {} } };
  const fields = detailChanges(empty, snapshot);
  return (
    <div className="flex flex-col gap-4" data-testid="history-snapshot">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        {fields.map((field) => (
          <div key={field.field} className="contents">
            <dt className="text-muted-foreground">{fieldLabel(field.field, t)}</dt>
            <dd className="break-words">{formatField(field.field, field.after, i18n.language)}</dd>
          </div>
        ))}
        {snapshot.credits.map((credit) => (
          <div key={credit.name} className="contents">
            <dt className="text-muted-foreground">{credit.roles.map((role) => t(`songEditor.creditRoles.${role}`, { defaultValue: role })).join(", ")}</dt>
            <dd>{credit.name}</dd>
          </div>
        ))}
      </dl>
      <SongChart chart={chart} emptyText={t("sets.noChart")} />
    </div>
  );
}
