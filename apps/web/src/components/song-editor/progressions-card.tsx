import type { SectionProgression, SongVersionSummary } from "@songverse/core";
import { Link } from "@tanstack/react-router";
import { Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { artistNames } from "#/lib/artists";

/** A section's name for a list: its label, or its type's (verse, chorus...). */
export function useSectionName() {
  const { t } = useTranslation();
  return (section: Pick<SectionProgression, "label" | "type">) => section.label ?? t(`chart.sections.${section.type}`, { defaultValue: section.type });
}

/**
 * One degree as Nashville charts write it: the number, a flat or sharp
 * before it, "m" beside it, the rest raised - 3⁷, 2m⁷, ♭7, 5/7 - so "37"
 * doesn't read as thirty-seven.
 */
export function Degree({ degree }: { degree: string }) {
  const match = /^([#b]?)([1-7])(m(?!aj))?([^/]*)(?:\/([#b]?)([1-7]))?$/.exec(degree);
  if (!match) return <>{degree}</>;
  const accidental = (text: string) => (text === "b" ? "♭" : text === "#" ? "♯" : "");
  // Half-diminished (m7♭5) as ø7, diminished as °, flats and sharps as ♭ and ♯.
  const halfDiminished = match[3] === "m" && match[4]!.startsWith("7b5");
  const raised = (halfDiminished ? `ø7${match[4]!.slice(3)}` : match[4]!)
    .replace(/dim7?/, (dim) => (dim === "dim7" ? "°7" : "°"))
    .replace(/b(?=\d)/g, "♭")
    .replace(/#(?=\d)/g, "♯");
  return (
    <span className="whitespace-nowrap">
      {accidental(match[1]!)}
      {match[2]}
      {halfDiminished ? "" : (match[3] ?? "")}
      {raised ? <sup className="text-[0.7em]">{raised}</sup> : null}
      {match[6] ? `/${accidental(match[5]!)}${match[6]}` : ""}
    </span>
  );
}

/** A progression written as degrees, spaced: "1 5 6m 4". */
export function Degrees({ degrees, className }: { degrees: string[]; className?: string }) {
  return (
    <span className={className ?? "font-mono text-sm"} data-degrees={degrees.join(" ")}>
      {degrees.map((degree, i) => (
        <span key={i}>
          {i > 0 ? " " : null}
          <Degree degree={degree} />
        </span>
      ))}
    </span>
  );
}

/**
 * A song's chord progressions (issue #204): each section's chords as
 * Nashville numbers of its key, and the songs (that the user can see) whose
 * chords move most like it, with the runs they share - for medleys and
 * transitions, or simply to find songs like this one.
 */
export function ProgressionsCard({ songVersionId }: { songVersionId: string }) {
  const { t } = useTranslation();
  const sectionName = useSectionName();
  const [data, setData] = useState<{ sections: SectionProgression[]; similar: (SongVersionSummary & { score: number; shared: string[] })[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    apiClient
      .getSongProgressions(songVersionId)
      .then((found) => !cancelled && setData(found))
      .catch(() => !cancelled && setData({ sections: [], similar: [] }));
    return () => {
      cancelled = true;
    };
  }, [songVersionId]);

  return (
    <Card data-testid="progressions-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Waypoints className="size-4 text-primary" aria-hidden />
          {t("progressions.title")}
        </CardTitle>
        <CardDescription>{t("progressions.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data === null ? null : data.sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("progressions.none")}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1 text-sm">
              {data.sections.map((section) => (
                <li key={section.sectionId} className="flex flex-wrap items-baseline gap-x-3">
                  <span className="w-24 shrink-0 text-muted-foreground">{sectionName(section)}</span>
                  <Degrees degrees={section.degrees} />
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2" data-testid="similar-progressions">
              <p className="text-sm font-medium">{t("progressions.similar")}</p>
              {data.similar.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("progressions.noSimilar")}</p>
              ) : (
                <ul className="flex flex-col divide-y text-sm">
                  {data.similar.map((song) => (
                    <li key={song.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0">
                      <span className="min-w-0">
                        <Link to="/library/$songVersionId" params={{ songVersionId: song.id }} className="font-medium hover:underline">
                          {song.title}
                        </Link>
                        {song.artists.length > 0 ? <span className="text-muted-foreground"> · {artistNames(song.artists)}</span> : null}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{song.shared.map((run) => run.split("-").join(" ")).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
