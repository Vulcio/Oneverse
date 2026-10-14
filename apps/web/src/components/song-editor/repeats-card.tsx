import type { SectionV2, SongRepeat } from "@songverse/core";
import { useRouter } from "@tanstack/react-router";
import { Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { apiClient } from "#/lib/api-client";

/**
 * A song's sections that repeat an earlier one (issue #231), for its
 * editors: the same, a few semitones up or down, with a few chords of
 * their own, or the end of it - each linked as a pass of the section it
 * repeats, or all at once. Shown once the song is saved as it is.
 */
export function RepeatsCard({ songVersionId, revision, sections, dirty }: { songVersionId: string; revision: number; sections: SectionV2[]; dirty: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [repeats, setRepeats] = useState<SongRepeat[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiClient.getSongRepeats(songVersionId).then(
      (found) => live && setRepeats(found.repeats),
      () => live && setRepeats([]),
    );
    return () => {
      live = false;
    };
  }, [songVersionId, revision]);

  if (repeats.length === 0) return done ? <p className="text-sm text-muted-foreground" role="status">{done}</p> : null;

  const nameOf = (id: string) => {
    const section = sections.find((one) => one.id === id);
    return section ? section.label || t(`chart.sections.${section.type}`) : "?";
  };
  const describe = (repeat: SongRepeat) => {
    const words = { name: nameOf(repeat.sectionId), of: nameOf(repeat.ofSectionId), steps: Math.abs(repeat.steps), direction: repeat.steps > 0 ? t("repeats.up") : t("repeats.down"), count: repeat.chords };
    if (repeat.kind === "same") return t("repeats.same", words);
    if (repeat.kind === "transposed") return t("repeats.transposed", words);
    if (repeat.kind === "lines") return t("repeats.lines", words);
    return repeat.steps ? t("repeats.transposedChords", words) : t("repeats.chords", words);
  };
  const link = async (sectionIds?: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const { linked } = await apiClient.linkSongRepeats(songVersionId, { revision, ...(sectionIds && { sectionIds }) });
      setDone(t("repeats.linked", { count: linked }));
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3" data-testid="song-repeats">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Link2 className="size-4 text-primary" aria-hidden />
          {t("repeats.found", { count: repeats.length })}
        </span>
        {repeats.length > 1 && !dirty ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => void link()} data-testid="repeats-link-all">
            {t("repeats.linkAll")}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{dirty ? t("repeats.saveFirst") : t("repeats.hint")}</p>
      <ul className="flex flex-col gap-1">
        {repeats.map((repeat) => (
          <li key={repeat.sectionId} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-repeat={repeat.kind}>
            <span>{describe(repeat)}</span>
            <Button type="button" variant="outline" size="sm" className="h-7" disabled={busy || dirty} onClick={() => void link([repeat.sectionId])} data-testid="repeat-link">
              {t("repeats.link")}
            </Button>
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
