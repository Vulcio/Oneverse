import type { MusicBrainzRecordingMatch, MusicBrainzWorkMatch } from "@songverse/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Input } from "@songverse/ui/components/input";

type Match = MusicBrainzRecordingMatch | MusicBrainzWorkMatch;

function isRecordingMatch(match: Match): match is MusicBrainzRecordingMatch {
  return "artist" in match;
}

function MatchSummary({ match }: { match: Match }) {
  const { t } = useTranslation();
  if (isRecordingMatch(match)) {
    return (
      <div className="text-sm">
        <p className="font-medium">{match.title}</p>
        <p className="text-muted-foreground">
          {match.artist ?? t("songEditor.unknownArtist")}
          {match.releaseTitle ? ` · ${match.releaseTitle}` : ""}
          {match.releaseDate ? ` · ${match.releaseDate.slice(0, 4)}` : ""}
        </p>
      </div>
    );
  }
  return (
    <div className="text-sm">
      <p className="font-medium">{match.title}</p>
      <p className="text-muted-foreground">
        {match.iswc ? `ISWC ${match.iswc}` : t("songEditor.links.noIswc")}
        {match.language ? ` · ${match.language}` : ""}
      </p>
    </div>
  );
}

/**
 * Search-and-link widget for either MusicBrainz entity a Song Version /
 * Work can carry: `recording` (artist + album — spec's "rich metadata")
 * links to a Song Version, `work` (the abstract composition, ISWC) links
 * to a Work. Same interaction shape for both, just a different search
 * form and result summary.
 */
export function MusicBrainzMatchPanel({
  kind,
  initialQuery,
  current,
  onSearch,
  onLink,
  onUnlink,
}: {
  kind: "recording" | "work";
  initialQuery: string;
  current: Match | null;
  onSearch: (title: string, artist?: string) => Promise<Match[]>;
  onLink: (mbid: string) => Promise<void>;
  onUnlink: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialQuery);
  const [artist, setArtist] = useState("");
  const [results, setResults] = useState<Match[] | null>(null);
  const [busyMbid, setBusyMbid] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch() {
    setSearching(true);
    setError(null);
    try {
      setResults(await onSearch(title, kind === "recording" ? artist || undefined : undefined));
    } catch {
      setError(t("songEditor.searchFailed"));
    } finally {
      setSearching(false);
    }
  }

  async function link(mbid: string) {
    setBusyMbid(mbid);
    setError(null);
    try {
      await onLink(mbid);
      setResults(null);
    } catch {
      setError(t("songEditor.links.linkFailed"));
    } finally {
      setBusyMbid(null);
    }
  }

  async function unlink() {
    setBusyMbid(current?.mbid ?? "unlink");
    setError(null);
    try {
      await onUnlink();
    } catch {
      setError(t("songEditor.links.unlinkFailed"));
    } finally {
      setBusyMbid(null);
    }
  }

  if (current) {
    return (
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <MatchSummary match={current} />
        <Button type="button" variant="outline" size="sm" onClick={() => void unlink()} disabled={busyMbid !== null}>
          {t("songEditor.links.unlink")}
        </Button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("songEditor.fields.title")}
          className="max-w-xs"
        />
        {kind === "recording" ? (
          <Input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder={t("songEditor.links.artistOptional")}
            className="max-w-xs"
          />
        ) : null}
        <Button type="button" onClick={() => void runSearch()} disabled={searching || !title.trim()}>
          {searching ? t("songEditor.searching") : t("songEditor.links.searchMusicBrainz")}
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {results ? (
        results.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("songEditor.noOnlineMatches")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {results.map((match) => (
              <li key={match.mbid} className="flex items-center justify-between gap-4 rounded-md border p-3">
                <MatchSummary match={match} />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void link(match.mbid)}
                  disabled={busyMbid !== null}
                >
                  {busyMbid === match.mbid ? t("songEditor.links.linking") : t("songEditor.links.link")}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
