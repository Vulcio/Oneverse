import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { ArtistPicture } from "#/components/artist-picture";
import { apiClient } from "#/lib/api-client";

/**
 * The artists of the songs you can see (issue #58), with their pictures
 * (issue #86) and how many songs each; one opens their page.
 */
export const Route = createFileRoute("/_protected/library/artists")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    // "?q=123" is read as a number.
    const q = typeof search.q === "number" ? String(search.q) : search.q;
    return typeof q === "string" && q.trim() ? { q } : {};
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => ({ artists: await apiClient.listArtists(deps.q) }),
  component: ArtistsPage,
});

function ArtistsPage() {
  const { t } = useTranslation();
  const { artists } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
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
      <h1 className="text-2xl font-semibold">{t("library.artists")}</h1>
      <Card className="gap-0 p-0">
        <div className="px-4 pt-4 pb-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("library.searchArtists")}
              aria-label={t("library.searchArtists")}
              className="pl-9"
            />
          </div>
        </div>
        {artists.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{search.q ? t("library.noArtistsMatch") : t("library.noArtistsYet")}</CardContent>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-4 gap-y-6 border-t p-4 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]" data-testid="artist-list">
            {artists.map((artist) => (
              <li key={artist.name}>
                <Link to="/library/artists/$name" params={{ name: artist.name }} className="group flex flex-col items-center gap-2 rounded-lg p-2 text-center hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  <ArtistPicture name={artist.name} imageUrl={artist.imageUrl} />
                  <span className="line-clamp-2 text-sm font-medium group-hover:text-primary">{artist.name}</span>
                  <span className="-mt-1.5 text-xs text-muted-foreground">{t("library.songCount", { count: artist.songCount })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-4 py-3 text-sm text-muted-foreground" data-testid="artist-count">
          {t("library.artistCount", { count: artists.length })}
        </div>
      </Card>
    </div>
  );
}
