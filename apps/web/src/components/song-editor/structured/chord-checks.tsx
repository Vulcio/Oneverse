import { sectionName, sectionNumbers, type ChartChordChecks, type ChordCheck, type SectionV2 } from "@oneverse/core";
import type { Editor } from "@tiptap/react";
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";
import { explainChordCheck, keepChord, keepKey } from "#/lib/chord-checks";
import { selectChordById, setChordById } from "./extensions";

/**
 * Chords that seem out of place (issue #356), above the chart in the
 * editor: each with why, in words, and what it might be meant to be - Use
 * puts that in, Keep leaves it as written and stops marking it, Show
 * selects it on the chart. A key the chords mostly don't fit is said once
 * here instead. Nothing changes unless it's chosen.
 */
export function ChordChecksCard({ editor, checks, sections, onSongKeyChange }: { editor: Editor; checks: ChartChordChecks; sections: SectionV2[]; onSongKeyChange: (key: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const { keyCheck, chords } = checks;
  if (!keyCheck && chords.length === 0) return null;
  const numbers = sectionNumbers(sections);
  const nameOf = (id: string) => {
    const section = sections.find((one) => one.id === id);
    return section ? (sectionName(section, numbers.get(id), (type) => t(`chart.sections.${type}`)) ?? t("chart.sections.other")) : "";
  };
  const count = chords.length + (keyCheck ? 1 : 0);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 p-3" data-testid="chord-checks">
      <button type="button" className="flex items-center justify-between gap-2 text-left text-sm font-medium" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex items-center gap-2">
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
          {keyCheck && chords.length === 0 ? t("chordChecks.keyCheck", { outside: keyCheck.outsideWritten, total: keyCheck.total, written: keyCheck.written, fits: keyCheck.fits }) : t("chordChecks.found", { count })}
        </span>
        {open ? <ChevronUp className="size-4 shrink-0" aria-hidden /> : <ChevronDown className="size-4 shrink-0" aria-hidden />}
      </button>
      {open ? (
        <>
          <p className="text-xs text-muted-foreground">
            {checks.keyGuessed && checks.key ? `${t("chordChecks.guessedKey", { key: checks.key })} ` : ""}
            {t("chordChecks.hint")}
          </p>
          <ul className="flex flex-col gap-2">
            {keyCheck ? (
              <li className="flex flex-col gap-1.5 rounded border bg-background p-2 text-sm" data-testid="chord-check-key">
                {chords.length > 0 ? <span>{t("chordChecks.keyCheck", { outside: keyCheck.outsideWritten, total: keyCheck.total, written: keyCheck.written, fits: keyCheck.fits })}</span> : null}
                <span className="text-xs text-muted-foreground">{t("chordChecks.keyHint")}</span>
                <span className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" className="h-7" onClick={() => onSongKeyChange(keyCheck.fits)} data-testid="chord-check-set-key">
                    {t("chordChecks.setKey", { key: keyCheck.fits })}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => keepKey(keyCheck.written, keyCheck.fits)} data-testid="chord-check-keep-key">
                    {t("chordChecks.keepKey", { key: keyCheck.written })}
                  </Button>
                </span>
              </li>
            ) : null}
            {chords.map((check) => (
              <li key={check.chordId} className="flex flex-col gap-1.5 rounded border bg-background p-2 text-sm" data-testid="chord-check" data-chord={check.raw} data-reason={check.reason.kind}>
                <span className="flex items-baseline gap-2">
                  <span className="font-mono font-bold text-primary">{check.raw}</span>
                  <span className="text-xs text-muted-foreground">{nameOf(check.sectionId)}</span>
                </span>
                <span>{explainChordCheck(t, check)}</span>
                <ChordCheckActions editor={editor} check={check} withShow />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Use the suggestion, keep the chord as written, or show it on the chart. */
export function ChordCheckActions({ editor, check, withShow = false, large = false }: { editor: Editor; check: ChordCheck; withShow?: boolean; large?: boolean }) {
  const { t } = useTranslation();
  const size = large ? "h-10" : "h-7";
  // A press mustn't take the selection from the chart (the chord's tools would close).
  const keep = (event: SyntheticEvent) => event.preventDefault();
  return (
    <span className="flex flex-wrap gap-2">
      {check.suggestion ? (
        <Button type="button" size="sm" className={size} onMouseDown={keep} onClick={() => setChordById(editor.view, check.chordId, check.suggestion!)} data-testid="chord-check-use">
          {t("chordChecks.use", { chord: check.suggestion })}
        </Button>
      ) : null}
      <Button type="button" size="sm" variant="outline" className={size} onMouseDown={keep} onClick={() => keepChord(check)} data-testid="chord-check-keep">
        {t("chordChecks.keep", { chord: check.raw })}
      </Button>
      {withShow ? (
        <Button type="button" size="sm" variant="ghost" className={size} onClick={() => selectChordById(editor.view, check.chordId)} data-testid="chord-check-show">
          {t("chordChecks.show")}
        </Button>
      ) : null}
    </span>
  );
}

/** The selected chord's reason for seeming out of place, in its tools (the popover with a mouse, the chord bar on a touch screen). */
export function ChordCheckNotice({ editor, check, large = false }: { editor: Editor; check: ChordCheck; large?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/5 p-2", large ? "text-sm" : "text-xs")} data-testid="chord-check-notice">
      <span className="flex items-center gap-1.5 font-medium">
        <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
        {t("chordChecks.label")}
      </span>
      <span>{explainChordCheck(t, check)}</span>
      <ChordCheckActions editor={editor} check={check} large={large} />
    </div>
  );
}
