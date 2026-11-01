import { METADATA_PROVIDER_NAMES, type ChordContent, type ChordSong, type ChordVersion, type MetadataMatch } from "@oneverse/core";
import { Search, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Input } from "@oneverse/ui/components/input";
import { apiClient } from "#/lib/api-client";

const versionKey = (version: ChordVersion) => `${version.providerId}:${version.songId}:${version.versionId ?? ""}`;

/** The music services that have the song too, by name. */
const servicesOf = (match: MetadataMatch | null) => [...new Set((match?.sources ?? []).filter((source) => source.provider !== "song_providers").map((source) => METADATA_PROVIDER_NAMES[source.provider]))];

/** A version's rating, as stars and how many gave it. */
function Rating({ rating }: { rating: NonNullable<ChordVersion["rating"]> }) {
  const { t, i18n } = useTranslation();
  const value = rating.value.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const label = rating.count != null ? t("plugins.rated", { value, count: rating.count }) : t("plugins.ratedNoCount", { value });
  return (
    <span className="inline-flex items-center gap-0.5" title={label} aria-label={label} role="img" data-testid="find-chords-rating">
      <Star className="size-3 fill-amber-400 text-amber-500" aria-hidden />
      {value}
      {rating.count != null ? <span aria-hidden>({rating.count.toLocaleString(i18n.language)})</span> : null}
    </span>
  );
}

/** One chart of a song: what sets it apart, its rating, where it comes from. */
function VersionRow({ version, busy, taking, onTake }: { version: ChordVersion; busy: boolean; taking: boolean; onTake: () => void }) {
  const { t } = useTranslation();
  const facts = [
    version.key ? t("plugins.musicKey", { key: version.key }) : null,
    version.capo ? t("plugins.capo", { fret: version.capo }) : null,
    version.author ? t("plugins.byAuthor", { name: version.author }) : null,
    version.source ? t("plugins.fromVia", { source: version.source.name, name: version.providerName }) : t("plugins.from", { name: version.providerName }),
  ].filter(Boolean);
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5" data-testid="find-chords-version">
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{version.name ?? t("plugins.defaultVersion")}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {version.rating ? <Rating rating={version.rating} /> : null}
          {version.rating ? <span aria-hidden>·</span> : null}
          <span>{facts.join(" · ")}</span>
        </span>
      </span>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onTake}>
        {taking ? t("plugins.loadingChart") : t("plugins.useChart")}
      </Button>
    </li>
  );
}

/** A song found: its details (with the music services'), and its versions, the best rated shown first. */
function SongRow({ song, taking, onTake }: { song: ChordSong; taking: string | null; onTake: (song: ChordSong, version: ChordVersion) => void }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const services = servicesOf(song.match);
  const shown = all ? song.versions : song.versions.slice(0, 1);
  return (
    <li className="flex flex-col gap-1 py-2" data-testid="find-chords-song">
      <div className="flex min-w-0 items-center gap-3">
        {song.thumbnailUrl ? <img src={song.thumbnailUrl} alt="" className="size-10 shrink-0 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" /> : null}
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{song.title}</span>
          <span className="block text-xs text-muted-foreground">{[song.artists.join(", "), song.album, song.releaseDate?.slice(0, 4)].filter(Boolean).join(" · ")}</span>
          {services.length ? (
            <span className="block text-xs text-muted-foreground" data-testid="find-chords-services">
              {t("plugins.alsoAt", { names: services.join(", ") })}
            </span>
          ) : null}
        </span>
      </div>
      <ul className="flex flex-col divide-y ps-3 sm:ps-13">
        {shown.map((version) => (
          <VersionRow key={versionKey(version)} version={version} busy={!!taking} taking={taking === versionKey(version)} onTake={() => onTake(song, version)} />
        ))}
      </ul>
      {song.versions.length > 1 ? (
        <Button type="button" variant="link" size="sm" className="self-start px-0 sm:ms-13" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? t("plugins.hideVersions") : `${t("plugins.showVersions")} (${t("plugins.versionsCount", { count: song.versions.length })})`}
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Find chords (issues #157, #369): the song looked up at the Song provider
 * plugin's servers - one row per song, its versions from every server, the
 * best rated first, with the music services' details of it - and a chosen
 * version's chords and lyrics read in as ChordPro, with where they came
 * from and what its provider says of its rights. `onChart` gets the
 * services' match too, for their details to be reviewed. Shown only where
 * an admin set a server up for chords.
 */
export function FindChords({
  title,
  artist,
  language,
  onChart,
}: {
  title: string;
  artist?: string;
  language?: string;
  onChart: (chart: ChordContent, match: MetadataMatch | null) => void;
}) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(title);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ChordSong[] | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [taking, setTaking] = useState<string | null>(null);
  const [taken, setTaken] = useState<{ chart: ChordContent; services: string[] } | null>(null);

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
      setResults(answer.songs);
      setUnavailable(answer.unavailable);
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const take = async (song: ChordSong, version: ChordVersion) => {
    setTaking(versionKey(version));
    setError(null);
    try {
      const chart = await apiClient.getChordContent(version.providerId, version.songId, version.versionId);
      onChart(chart, song.match);
      setTaken({ chart, services: servicesOf(song.match) });
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
              {results.map((song) => (
                <SongRow key={versionKey(song.versions[0]!)} song={song} taking={taking} onTake={(chosen, version) => void take(chosen, version)} />
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
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p role="status" data-testid="find-chords-source">
            {taken.chart.source ? t("plugins.chartFromVia", { source: taken.chart.source.name, name: taken.chart.providerName }) : t("plugins.chartFrom", { name: taken.chart.providerName })}
            {taken.chart.copyright ? ` © ${taken.chart.copyright}.` : null}
            {taken.chart.rights ? ` ${taken.chart.rights}` : null}
            {taken.chart.url ? (
              <>
                {" "}
                <a className="break-all text-primary hover:underline" href={taken.chart.url} target="_blank" rel="noreferrer">
                  {taken.chart.url}
                </a>
              </>
            ) : null}
          </p>
          {taken.services.length ? <p data-testid="find-chords-review-hint">{t("plugins.detailsToReview", { names: taken.services.join(", ") })}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
