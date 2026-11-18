import type { YouVersionSearchResult } from "@oneverse/core";
import { SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { FieldError } from "@oneverse/ui/components/field";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { Spinner } from "@oneverse/ui/components/spinner";
import { cn } from "@oneverse/ui/lib/utils";
import type { PickerVersion } from "#/components/passage-picker";
import { apiClient } from "#/lib/api-client";

type Intent = "unknown" | "text" | "topical" | "reference";

/**
 * Searching a YouVersion version (issue #507), with YouVersion's Search API:
 * words, a theme or a reference, searched on Enter or the button - never as
 * one types, as YouVersion allows an app 200 requests an hour until it's
 * live. Verses come as references: one is read (`onPick`) when it's picked,
 * never all at once. Related topics and the spellings YouVersion suggests
 * are searched in turn when tapped. No images.
 */
export function BibleSearch({ version, language, onPick, picked }: { version: PickerVersion | null; language: string; onPick: (reference: string) => void; picked: string | null }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<{ query: string; intent: Intent } | null>(null);
  const [result, setResult] = useState<YouVersionSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const youversion = version?.kind === "youversion" ? Number(version.id) : null;

  // Another version or language: its own search.
  useEffect(() => {
    setResult(null);
    setSearched(null);
    setError(null);
  }, [youversion, language]);

  async function search(text: string, intent: Intent = "unknown", page?: string) {
    const clean = text.trim().slice(0, 100);
    if (!youversion || !clean) return;
    setBusy(true);
    setError(null);
    try {
      const found = await apiClient.searchYouVersion(youversion, { query: clean, language, intent, ...(page ? { page } : {}) });
      if (page && result) {
        // More verses: after those shown, each once.
        const seen = new Set(result.verses.map((one) => one.id));
        setResult({ ...result, verses: [...result.verses, ...found.verses.filter((one) => !seen.has(one.id))], next: found.next });
      } else {
        setQuery(clean);
        setSearched({ query: clean, intent });
        setResult(found);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!version) return null;
  return (
    <section className="flex flex-col gap-3" data-testid="bible-search">
      <div>
        <h2 className="text-base font-semibold">{t("biblePage.search")}</h2>
        <p className="text-xs text-muted-foreground">{youversion ? t("biblePage.searchHint") : t("biblePage.searchOnlyYouVersion")}</p>
      </div>
      {youversion ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search(query);
          }}
        >
          <Label htmlFor="bible-search-query" className="sr-only">
            {t("biblePage.search")}
          </Label>
          <Input id="bible-search-query" type="search" value={query} maxLength={100} placeholder={t("biblePage.searchPlaceholder")} onChange={(event) => setQuery(event.target.value)} data-testid="bible-search-query" />
          <Button type="submit" variant="secondary" disabled={busy || !query.trim()} data-testid="bible-search-button">
            {busy ? <Spinner /> : <SearchIcon />}
            {t("biblePage.searchButton")}
          </Button>
        </form>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
      {result && searched ? (
        <div className="flex flex-col gap-3" data-testid="bible-search-results">
          {result.searchInsteadFor || result.didYouMean.length || (result.userIntent && result.userIntent !== "unknown") ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {result.searchInsteadFor ? <span data-testid="bible-search-instead">{t("biblePage.searchInsteadFor", { query: result.searchInsteadFor })}</span> : null}
              {result.didYouMean.length ? (
                <span className="flex flex-wrap items-center gap-1" data-testid="bible-search-did-you-mean">
                  <span className="text-muted-foreground">{t("biblePage.searchDidYouMean")}</span>
                  {result.didYouMean.map((one) => (
                    <Button key={one} type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => void search(one)}>
                      {one}
                    </Button>
                  ))}
                </span>
              ) : null}
              {result.userIntent && result.userIntent !== "unknown" ? (
                <Badge variant="outline" className="font-normal" data-testid="bible-search-intent">
                  {t(`biblePage.searchIntent_${result.userIntent}`)}
                </Badge>
              ) : null}
            </div>
          ) : null}
          {result.userIntent === "reference" ? (
            <div>
              <Button type="button" size="sm" onClick={() => onPick(searched.query)} data-testid="bible-search-read-reference">
                {t("biblePage.searchReadReference", { reference: searched.query })}
              </Button>
            </div>
          ) : null}
          {result.verses.length === 0 && result.topics.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="bible-search-none">
              {t("biblePage.searchNone", { query: searched.query })}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
            {result.verses.length ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("biblePage.searchVerses")}</h3>
                <div className="flex flex-wrap gap-1.5" data-testid="bible-search-verses">
                  {result.verses.map((verse) => (
                    <Button
                      key={verse.id}
                      type="button"
                      size="sm"
                      variant={picked === verse.reference ? "default" : "outline"}
                      className={cn("h-8 tabular-nums")}
                      aria-pressed={picked === verse.reference}
                      onClick={() => onPick(verse.reference)}
                    >
                      {verse.reference}
                    </Button>
                  ))}
                </div>
                {result.next ? (
                  <div>
                    <Button type="button" variant="ghost" size="sm" className="mt-1" disabled={busy} onClick={() => void search(searched.query, searched.intent, result.next!)} data-testid="bible-search-more">
                      {t("biblePage.searchMore")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div />
            )}
            {result.topics.length ? (
              <div className="flex flex-col gap-1" data-testid="bible-search-topics">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("biblePage.searchTopics")}</h3>
                <ul className="flex flex-col gap-1.5">
                  {result.topics.map((topic) => (
                    <li key={`${topic.id ?? ""}${topic.text}`} className="flex flex-wrap items-center gap-1">
                      <Button type="button" variant="secondary" size="sm" className="h-7" onClick={() => void search(topic.text, "topical")}>
                        {topic.text}
                      </Button>
                      {topic.subtopics.map((sub) => (
                        <Button key={sub} type="button" variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={() => void search(sub, "topical")}>
                          {sub}
                        </Button>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
