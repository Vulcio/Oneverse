import type { SectionProgression, SongVersionSummary } from "@oneverse/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Degrees, useSectionName } from "#/components/song-editor/progressions-card";
import { apiClient } from "#/lib/api-client";
import { artistNames } from "#/lib/artists";

type Found = { query: string[] | null; songs: (SongVersionSummary & { sections: SectionProgression[] })[] };

/**
 * Songs by chord progression (issue #204): type "1 5 6m 4" or "I V vi IV"
 * and find the songs you can see whose chords go that way, in any key, with
 * the sections it's in. A section is read as a loop, so 6m 4 1 5 is found too.
 */
export const Route = createFileRoute("/_protected/library/progressions")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    const q = typeof search.q === "number" ? String(search.q) : search.q;
    return typeof q === "string" && q.trim() ? { q } : {};
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }): Promise<Found> => (deps.q ? apiClient.searchProgressions(deps.q) : { query: null, songs: [] }),
  component: ProgressionsPage,
});

const EXAMPLES = ["1 5 6m 4", "1 4 5", "6m 4 1 5", "2m 5 1", "1 b7 4"];

function ProgressionsPage() {
  const { t } = useTranslation();
  const found = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const sectionName = useSectionName();
  const [query, setQuery] = useState(search.q ?? "");

  // Search as you type, a moment after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (q === (search.q ?? "")) return;
    const timer = setTimeout(() => void navigate({ search: { q: q || undefined }, replace: true }), 300);
    return () => clearTimeout(timer);
  }, [query, search.q, navigate]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Waypoints className="size-5 text-primary" aria-hidden />
          {t("progressions.page")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("progressions.pageDescription")}</p>
      </div>
      <Card className="gap-0 p-0">
        <div className="flex flex-col gap-2 px-4 pt-4 pb-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="1 5 6m 4"
            aria-label={t("progressions.searchLabel")}
            className="max-w-sm font-mono"
            data-testid="progression-query"
          />
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {t("progressions.try")}
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="rounded border px-1.5 py-0.5 font-mono hover:bg-muted" onClick={() => setQuery(example)}>
                {example}
              </button>
            ))}
          </p>
        </div>
        {!search.q ? null : found.query === null ? (
          <CardContent className="border-t py-6 text-sm text-muted-foreground">{t("progressions.notAProgression")}</CardContent>
        ) : found.songs.length === 0 ? (
          <CardContent className="border-t py-6 text-sm text-muted-foreground">{t("progressions.noMatch", { progression: found.query.join(" ") })}</CardContent>
        ) : (
          <ul className="flex flex-col divide-y border-t" data-testid="progression-results">
            {found.songs.map((song) => (
              <li key={song.id} className="flex flex-col gap-1 px-4 py-3" data-song={song.id}>
                <span>
                  <Link to="/library/$songVersionId" params={{ songVersionId: song.id }} className="font-medium hover:underline">
                    {song.title}
                  </Link>
                  {song.artists.length > 0 ? <span className="text-sm text-muted-foreground"> · {artistNames(song.artists)}</span> : null}
                </span>
                <ul className="flex flex-col gap-0.5 text-sm">
                  {song.sections.map((section) => (
                    <li key={section.sectionId} className="flex flex-wrap items-baseline gap-x-3">
                      <span className="w-24 shrink-0 text-muted-foreground">{sectionName(section)}</span>
                      <Degrees degrees={section.degrees} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
