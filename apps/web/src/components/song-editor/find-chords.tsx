import type { ChordContent, ChordSearchResult } from "@oneverse/core";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Input } from "@oneverse/ui/components/input";
import { apiClient } from "#/lib/api-client";

/**
 * Find chords (issue #157): the song looked up at the Song provider
 * plugin's servers, and a chosen one's chords and lyrics read in as
 * ChordPro, with where they came from and what its provider says of its
 * rights. Shown only where an admin set a server up for chords.
 */
export function FindChords({ title, artist, language, onChart }: { title: string; artist?: string; language?: string; onChart: (chart: ChordContent) => void }) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(title);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ChordSearchResult[] | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [taking, setTaking] = useState<string | null>(null);
  const [taken, setTaken] = useState<ChordContent | null>(null);

  useEffect(() => {
    let live = true;
    apiClient
      .getChordSources()
      .then((answer) => live && setProviders(answer.available ? answer.providers : []))
      .catch(() => live && setProviders([]));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!open) setQuery(title);
  }, [title, open]);

  if (!providers?.length) return null;

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await apiClient.searchChords({ title: query.trim(), ...(artist?.trim() && { artist: artist.trim() }), ...(language && { language }) });
      setResults(answer.results);
      setUnavailable(answer.unavailable);
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const take = async (result: ChordSearchResult) => {
    setTaking(`${result.providerId}:${result.id}`);
    setError(null);
    try {
      const chart = await apiClient.getChordContent(result.providerId, result.id);
      onChart(chart);
      setTaken(chart);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTaking(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 text-sm" data-testid="find-chords">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">{t("plugins.findChordsHint", { providers: providers.join(", ") })}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(true);
              if (query.trim()) void search();
            }}
          >
            <Search aria-hidden />
            {t("plugins.findChords")}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              aria-label={t("plugins.findChordsTitle")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void search();
                }
              }}
            />
            <Button type="button" size="sm" disabled={busy || !query.trim()} onClick={() => void search()}>
              {busy ? t("plugins.searching") : t("plugins.search")}
            </Button>
          </div>
          {unavailable.length ? <p className="text-xs text-muted-foreground">{t("plugins.unavailable", { names: unavailable.join(", ") })}</p> : null}
          {results && results.length === 0 ? <p className="text-muted-foreground">{t("plugins.noChords")}</p> : null}
          {results?.length ? (
            <ul className="flex flex-col divide-y" data-testid="find-chords-results">
              {results.map((result) => (
                <li key={`${result.providerId}:${result.id}`} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{result.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[result.artists.join(", "), result.key, t("plugins.from", { name: result.providerName })].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Button type="button" size="sm" variant="outline" disabled={!!taking} onClick={() => void take(result)}>
                    {taking === `${result.providerId}:${result.id}` ? t("plugins.loadingChart") : t("plugins.useChart")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {error ? (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {taken ? (
        <p className="text-xs text-muted-foreground" role="status" data-testid="find-chords-source">
          {t("plugins.chartFrom", { name: taken.providerName })}
          {taken.copyright ? ` © ${taken.copyright}.` : null}
          {taken.rights ? ` ${taken.rights}` : null}
          {taken.url ? (
            <>
              {" "}
              <a className="text-primary hover:underline" href={taken.url} target="_blank" rel="noreferrer">
                {taken.url}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
