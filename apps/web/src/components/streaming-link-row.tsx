import type { LinkCandidate, SongVersionLink } from "@oneverse/core";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";

export function StreamingLinkRow({
  id,
  label,
  current,
  onSave,
  onRemove,
  onSearch,
}: {
  id: string;
  label: string;
  current: SongVersionLink | undefined;
  onSave: (url: string) => Promise<void>;
  onRemove: () => Promise<void>;
  /** The song looked up at this service (issue #169); left out where it can't be. */
  onSearch?: () => Promise<LinkCandidate[]>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(current?.sourceUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LinkCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function save(url = value) {
    setBusy(true);
    setError(null);
    try {
      await onSave(url);
      setValue(url);
      setResults(null);
    } catch {
      setError(t("songEditor.links.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onRemove();
      setValue("");
    } catch {
      setError(t("songEditor.links.removeFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    if (!onSearch) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await onSearch());
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : t("songEditor.links.searchFailed"));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="flex flex-col gap-1" data-testid={id}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("songEditor.links.pastePlaceholder")} />
        </div>
        {onSearch ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => void (results ? setResults(null) : search())}
            disabled={busy || searching}
            aria-label={results ? t("songEditor.links.closeSearch") : t("songEditor.links.searchAt", { service: label })}
            title={results ? t("songEditor.links.closeSearch") : t("songEditor.links.searchAt", { service: label })}
            aria-expanded={!!results}
            data-testid={`${id}-search`}
          >
            {results ? <X /> : <Search />}
          </Button>
        ) : null}
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy || !value.trim()}>
          {busy ? t("songEditor.saving") : t("songEditor.links.save")}
        </Button>
        {current ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void remove()} disabled={busy}>
            {t("songEditor.links.clear")}
          </Button>
        ) : null}
      </div>
      {searching ? <p className="text-xs text-muted-foreground">{t("songEditor.links.searching")}</p> : null}
      {results ? (
        results.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("songEditor.links.noResults", { service: label })}</p>
        ) : (
          <ul className="mt-1 flex flex-col divide-y rounded-md border" aria-label={t("songEditor.links.resultsAt", { service: label })} data-testid={`${id}-results`}>
            {results.map((result) => (
              <li key={result.url}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 p-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void save(result.url)}
                >
                  {result.thumbnailUrl ? (
                    <img src={result.thumbnailUrl} alt="" className="size-10 shrink-0 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="size-10 shrink-0 rounded bg-muted" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{result.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[result.artist, result.album].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
