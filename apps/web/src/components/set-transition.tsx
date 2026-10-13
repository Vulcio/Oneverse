import { degreeChords, SET_TRANSITIONS, transitionDegrees, transitionProgressions, type TransitionForm, type ChordDiagramsValue, type ChordNotationValue, type DiagramPlayer, type SetTransitionValue, type SetTransitionView } from "@songverse/core";
import { ArrowDown, ArrowRight, ArrowRightLeft, ChevronLeft, ChevronRight, ChevronsDown, Music, Square, Zap, type LucideIcon } from "lucide-react";
import { useMemo, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ChordRow, ChordSteps } from "#/components/chord-diagrams";
import { Button } from "@songverse/ui/components/button";
import { Input } from "@songverse/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@songverse/ui/components/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@songverse/ui/components/dropdown-menu";
import { cn } from "@songverse/ui/lib/utils";

/**
 * What happens after a song of a set (issue #199), as a symbol: a square
 * for the end, an arrow straight down for the next, a double one for a
 * segue (no pause), crossing arrows for a transition.
 */
export const TRANSITION_ICONS: Record<SetTransitionValue, LucideIcon> = { STOP: Square, NEXT: ArrowDown, SEGUE: ChevronsDown, TRANSITION: ArrowRightLeft };

export function TransitionSymbol({ kind, className }: { kind: SetTransitionValue | null | undefined; className?: string }) {
  const { t } = useTranslation();
  if (!kind) return null;
  const Icon = TRANSITION_ICONS[kind];
  return <Icon className={cn("size-3.5 shrink-0", className)} aria-label={t(`sets.transitions.${kind}`)} role="img" data-testid="set-transition" data-kind={kind} />;
}

/**
 * The symbol as a menu, for who can change the set: no transition said, or
 * one of the four. (A transition's note is written on the set's page.)
 */
export function TransitionPicker({ kind, onChange, className }: { kind: SetTransitionValue | null | undefined; onChange: (kind: SetTransitionValue | null) => void; className?: string }) {
  const { t } = useTranslation();
  const Icon = kind ? TRANSITION_ICONS[kind] : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn("flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-foreground", className)}
            aria-label={kind ? t("sets.transitionIs", { kind: t(`sets.transitions.${kind}`) }) : t("sets.setTransition")}
            title={kind ? t(`sets.transitions.${kind}`) : t("sets.setTransition")}
            data-testid="set-transition-picker"
            data-kind={kind ?? ""}
          />
        }
      >
        {Icon ? <Icon className="size-3.5" /> : <span className="size-1 rounded-full bg-current opacity-40" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>{t("sets.afterThisSong")}</DropdownMenuLabel>
        {SET_TRANSITIONS.map((one) => {
          const ItemIcon = TRANSITION_ICONS[one];
          return (
            <DropdownMenuItem key={one} onClick={() => onChange(one)} className={cn(kind === one && "font-semibold")} data-testid={`set-transition-${one}`}>
              <ItemIcon />
              {t(`sets.transitions.${one}`)}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuItem onClick={() => onChange(null)} data-testid="set-transition-none">
          <span className="size-4" />
          {t("sets.transitions.none")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** In Live, before the end of the song: what comes next - "Segue: no pause", "Key change: G → A · 72 → 96 BPM · Pad under the prayer". */
export function transitionText(view: SetTransitionView, t: (key: string, options?: Record<string, unknown>) => string): string {
  const parts: string[] = [t(`sets.transitionsLive.${view.kind}`)];
  if (view.kind === "TRANSITION" || view.kind === "SEGUE") {
    if (view.fromKey && view.toKey && view.fromKey !== view.toKey) parts.push(t("sets.keyChange", { from: view.fromKey, to: view.toKey }));
    if (view.fromTempo && view.toTempo && Math.round(view.fromTempo) !== Math.round(view.toTempo)) parts.push(t("sets.tempoChange", { from: Math.round(view.fromTempo), to: Math.round(view.toTempo) }));
  }
  if (view.note) parts.push(view.note);
  return parts.join(" · ");
}

/**
 * The chords played into the next song (issues #10, #217), for who edits the
 * set: a button showing them, opening the chooser. Kept as degrees of the
 * next song's key, so they follow it when it's moved.
 */
export function TransitionChordsPicker(props: Omit<ComponentProps<typeof TransitionChordsChooser>, "framed" | "className"> & { className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = props.toKey ? degreeChords(props.degrees, props.toKey) : props.degrees;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("h-8 gap-1.5 font-normal", props.className)}
            aria-label={t("sets.transitionChordsLabel")}
            data-testid="set-song-transition-chords"
            data-degrees={props.degrees.join(" ")}
          />
        }
      >
        <Music className="size-3.5" />
        {current.length > 0 ? <span className="font-semibold">{current.join(" ")}</span> : t("sets.transitionChords")}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-80 overflow-y-auto sm:w-96" data-testid="transition-chords-picker">
        <TransitionChordsChooser
          {...props}
          className={undefined}
          onVariation={props.onChange}
          onChange={(degrees) => {
            props.onChange(degrees);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Choosing a transition's chords (issues #10, #217): from this song's last
 * chord to the next one's first, the styles of transition for the two keys
 * as they're played, as many chords as asked for, or typed (letters, or
 * Nashville numbers); every chord tapped to hear it. In the picker's popup
 * on the set's page, and under Live's transition when it's opened (#214).
 */
export function TransitionChordsChooser({
  fromKey,
  toKey,
  lastChord,
  firstChord,
  degrees,
  onChange,
  diagrams,
  notation = "LETTERS",
  player,
  framed = true,
  onVariation,
  className,
}: {
  fromKey: string | null;
  toKey: string | null;
  /** This song's last chord and the next one's first, as played (issue #217). */
  lastChord?: string | null;
  firstChord?: string | null;
  degrees: string[];
  onChange: (degrees: string[]) => void;
  /** The player's instrument and names (Live), for what's heard; a guitar otherwise. */
  diagrams?: ChordDiagramsValue;
  notation?: ChordNotationValue;
  player?: DiagramPlayer;
  /** With the song's last chord and the next one's first around the choice; not where they're shown already. */
  framed?: boolean;
  /** Another variation of the chosen way in (a popup stays open for it); `onChange` when left out. */
  onVariation?: (degrees: string[]) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [fast, setFast] = useState(false);
  const [typed, setTyped] = useState("");
  const [invalid, setInvalid] = useState(false);
  const suggestions = useMemo(() => transitionProgressions(fromKey, toKey, { fast, firstChord, lastChord }), [fromKey, toKey, fast, firstChord, lastChord]);
  const current = toKey ? degreeChords(degrees, toKey) : degrees;
  const chosen = degrees.join(" ");
  const row = (chords: string[], testId: string) => <ChordRow chords={chords} names diagrams={diagrams} notation={notation} player={player} musicalKey={toKey} testId={testId} />;

  const pick = onChange;
  function keepTyped() {
    // Without the next song's key, only numbers can be kept.
    const read = transitionDegrees(typed, toKey ?? "C");
    const ok = read && read.length > 0 && read.length <= 8 && (toKey || typed.trim().split(/[\s,]+/).every((part) => /^[#b]?[1-7]/.test(part)));
    if (!ok) return setInvalid(true);
    setInvalid(false);
    setTyped("");
    pick(read);
  }

  return (
      <div className={cn("flex flex-col gap-3", className)} data-testid="transition-chords-chooser">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{toKey ? t("sets.transitionChordsInto", { key: toKey }) : t("sets.transitionChordsLabel")}</p>
          {/* Fast: only what takes one chord, for when there's no room. */}
          {fromKey && toKey ? (
            <Button type="button" variant={fast ? "default" : "ghost"} size="sm" className="h-7 gap-1 px-2" aria-pressed={fast} onClick={() => setFast(!fast)} title={t("sets.transitionFastHint")} data-testid="transition-fast">
              <Zap className="size-3.5" />
              {t("sets.transitionFast")}
            </Button>
          ) : null}
        </div>
        {/* Where it goes from and to: the end of this song, what's chosen, the start of the next - each heard with a tap. */}
        {framed && (lastChord || firstChord) ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="transition-chords-frame">
            {lastChord ? (
              <span className="flex items-center gap-1">
                {t("sets.transitionFrom")}
                {row([lastChord], "transition-last-chord")}
              </span>
            ) : null}
            <ArrowRight className="size-3.5" aria-hidden />
            {current.length > 0 ? row(current, "transition-chosen-chords") : <span>…</span>}
            <ArrowRight className="size-3.5" aria-hidden />
            {firstChord ? (
              <span className="flex items-center gap-1">
                {t("sets.transitionTo")}
                {row([firstChord], "transition-first-chord")}
              </span>
            ) : null}
          </div>
        ) : null}
        {!fromKey || !toKey ? (
          <p className="text-xs text-muted-foreground">{t("sets.transitionChordsNeedKeys")}</p>
        ) : (
          <>
            <ul className="-mx-1 flex flex-col">
              {suggestions.map((one) => {
                const forms = [one, ...one.variations];
                const at = forms.findIndex((form) => form.degrees.join(" ") === chosen);
                const shown = forms[Math.max(0, at)]!;
                return (
                  <li
                    key={one.kind}
                    className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-1 py-1 sm:flex-nowrap", at >= 0 && "bg-muted")}
                    data-testid="transition-suggestion"
                    data-kind={one.kind}
                    data-degrees={one.degrees.join(" ")}
                  >
                    {/* On a phone, the name on its own line above the chords; beside them where there's room. */}
                    <span className="w-full truncate text-[0.7rem] leading-tight text-muted-foreground sm:w-24 sm:shrink-0 sm:whitespace-normal sm:text-xs" title={t(`sets.transitionBestWhen.${one.kind}`)}>
                      {t(`sets.transitionKinds.${one.kind}`)}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                      <ChordSteps steps={shown.chords.map((chord) => ({ chord, role: "option" }))} expanded={false} size="sm" diagrams={diagrams} notation={notation} player={player} musicalKey={toKey} />
                      {at >= 0 && forms.length > 1 ? <VariationSwitcher forms={forms} at={at} onPick={onVariation ?? pick} /> : null}
                    </span>
                    {at >= 0 ? null : (
                      <Button type="button" size="sm" variant="secondary" className="h-7 shrink-0" onClick={() => pick(one.degrees)} data-testid="transition-suggestion-use">
                        {t("sets.transitionChordsUse")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <form
          className="flex flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            keepTyped();
          }}
        >
          <span className="flex gap-1">
            <Input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={t("sets.transitionChordsOwn")} aria-label={t("sets.transitionChordsOwn")} className="h-8 text-sm" data-testid="transition-chords-typed" />
            <Button type="submit" size="sm" className="h-8" disabled={!typed.trim()} data-testid="transition-chords-typed-use">
              {t("sets.transitionChordsUse")}
            </Button>
          </span>
          {invalid ? <span className="text-xs text-destructive">{t("sets.transitionChordsInvalid")}</span> : null}
        </form>
        {degrees.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => pick([])} data-testid="transition-chords-clear">
            {t("sets.transitionChordsNone")}
          </Button>
        ) : null}
      </div>
  );
}

/** One way in's variations, the chosen one's place among them: ‹ 2/4 ›, each step chosen at once (issue #218). */
function VariationSwitcher({ forms, at, onPick }: { forms: TransitionForm[]; at: number; onPick: (degrees: string[]) => void }) {
  const { t } = useTranslation();
  const go = (step: 1 | -1) => onPick(forms[(at + step + forms.length) % forms.length]!.degrees);
  return (
    <span className="inline-flex items-center rounded-md border bg-background text-xs" role="group" aria-label={t("sets.transitionVariation")} data-testid="transition-variations">
      <button type="button" className="flex h-7 w-6 items-center justify-center text-muted-foreground hover:text-foreground" onClick={() => go(-1)} aria-label={t("sets.transitionVariationPrevious")} data-testid="transition-variation-previous">
        <ChevronLeft className="size-3.5" />
      </button>
      <span className="min-w-7 text-center tabular-nums" data-testid="transition-variation-position">
        {at + 1}/{forms.length}
      </span>
      <button type="button" className="flex h-7 w-6 items-center justify-center text-muted-foreground hover:text-foreground" onClick={() => go(1)} aria-label={t("sets.transitionVariationNext")} data-testid="transition-variation-next">
        <ChevronRight className="size-3.5" />
      </button>
    </span>
  );
}

/**
 * The chosen chords' variations, beside them (issue #218): when they're one
 * of the ways in, its others a tap away - A7 → A9 → A13 → A7♭9. Nothing
 * when they're typed, or the way in has no others.
 */
export function TransitionVariations({
  fromKey,
  toKey,
  lastChord,
  firstChord,
  degrees,
  onChange,
}: {
  fromKey: string | null;
  toKey: string | null;
  lastChord?: string | null;
  firstChord?: string | null;
  degrees: string[];
  onChange: (degrees: string[]) => void;
}) {
  const chosen = degrees.join(" ");
  const found = useMemo(() => {
    if (!chosen) return null;
    // The way in it's the usual form of, else one it's a variation of.
    const all = transitionProgressions(fromKey, toKey, { firstChord, lastChord }).map((one) => [one, ...one.variations]);
    const forms = all.find((list) => list[0]!.degrees.join(" ") === chosen) ?? all.find((list) => list.some((form) => form.degrees.join(" ") === chosen));
    if (!forms || forms.length < 2) return null;
    return { forms, at: forms.findIndex((form) => form.degrees.join(" ") === chosen) };
  }, [fromKey, toKey, firstChord, lastChord, chosen]);
  return found ? <VariationSwitcher forms={found.forms} at={found.at} onPick={onChange} /> : null;
}
