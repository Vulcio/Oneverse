import { cueAt, formatDuration, nextCueSection, snapToBeat, type CuePoint, type CueSection, type StructureGroup } from "@oneverse/core";
import { Crosshair, Flag, Loader2, Minus, Play, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { playStems, seekStems, useStems, type StemSong } from "#/lib/stem-engine";
import { cn } from "@oneverse/ui/lib/utils";

/** The structure bar's colours (Live, issue #68), as CSS colours. */
const GROUP_COLOURS: Record<StructureGroup, string> = {
  edge: "var(--color-violet-500)",
  verse: "var(--color-sky-500)",
  chorus: "var(--color-amber-400)",
  bridge: "var(--color-rose-500)",
  instrumental: "var(--color-emerald-500)",
  other: "var(--color-zinc-500)",
};
const GROUP_TEXT: Record<StructureGroup, string> = {
  edge: "text-white",
  verse: "text-white",
  chorus: "text-black",
  bridge: "text-white",
  instrumental: "text-white",
  other: "text-white",
};

/** A section's names: short (V1, C) for the strip, long (Verse 1, Chorus) for the rest. */
export function useCueNames() {
  const { t } = useTranslation();
  return {
    short: (section: CueSection) => `${t(`live.short.${section.type}`)}${section.number ?? ""}`,
    long: (section: CueSection) => section.label || `${t(`chart.sections.${section.type}`)}${section.number ? ` ${section.number}` : ""}`,
  };
}

/** Each cue with its section and where it ends (the next one, or the end). */
function spans(cues: CuePoint[], sections: CueSection[], duration: number) {
  return cues.flatMap((cue, index) => {
    const section = sections.find((candidate) => candidate.id === cue.sectionId);
    const end = Math.max(cue.at, Math.min(duration, cues[index + 1]?.at ?? duration));
    return section && duration > 0 && cue.at < duration ? [{ cue, index, section, start: cue.at, end }] : [];
  });
}

/**
 * The playhead line coloured by section (issue #110): each section in its
 * colour, full where it's been played, faint ahead, with a hairline between
 * two - the song's shape at a glance, even with the player minimized.
 */
export function sectionsGradient(cues: CuePoint[], sections: CueSection[], duration: number, progress: number): string | null {
  const parts = spans(cues, sections, duration);
  if (parts.length === 0) return null;
  const stops: string[] = [];
  const pct = (seconds: number) => `${((seconds / duration) * 100).toFixed(3)}%`;
  const faint = (colour: string) => `color-mix(in oklab, ${colour} 35%, transparent)`;
  const played = progress * duration;
  const firstStart = parts[0]!.start;
  if (firstStart > 0) stops.push(`var(--color-muted) 0%`, `var(--color-muted) ${pct(firstStart)}`);
  for (const part of parts) {
    const colour = GROUP_COLOURS[part.section.group];
    // A hairline where it starts.
    const from = Math.min(part.end, part.start + duration * 0.003);
    stops.push(`var(--color-background) ${pct(part.start)}`, `var(--color-background) ${pct(from)}`);
    if (played >= part.end) stops.push(`${colour} ${pct(from)}`, `${colour} ${pct(part.end)}`);
    else if (played <= from) stops.push(`${faint(colour)} ${pct(from)}`, `${faint(colour)} ${pct(part.end)}`);
    else stops.push(`${colour} ${pct(from)}`, `${colour} ${pct(played)}`, `${faint(colour)} ${pct(played)}`, `${faint(colour)} ${pct(part.end)}`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** While the sections are being placed: moving a cue by its handle (issue #110), snapped to the recording's beat when it has one. */
export interface LaneEditing {
  onMove: (index: number, at: number) => void;
  beat: { tempo: number; firstBeat: number } | null;
}

/**
 * The recording's sections as a strip (issue #110): each where it is and as
 * long as it lasts, in the structure bar's colours, the one playing ringed.
 * Tap one to go there. While they're being placed, each section's start has
 * a handle, as in a video editor's timeline - shown on hover, always on a
 * touch screen: drag it (snapped to the beat, Alt for anywhere), or focus it
 * and nudge with the arrow keys (a beat; Shift, 10 ms).
 */
export function SectionLane({
  cues,
  sections,
  duration,
  position,
  onSeek,
  editing,
}: {
  cues: CuePoint[];
  sections: CueSection[];
  duration: number;
  position: number;
  onSeek?: (at: number) => void;
  editing?: LaneEditing | null;
}) {
  const { t } = useTranslation();
  const names = useCueNames();
  const lane = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ index: number; at: number } | null>(null);
  const parts = spans(cues, sections, duration);
  const current = cueAt(cues, position);
  if (parts.length === 0) return null;

  /** Where `index` may go: between its neighbours, a little clear of each. */
  const clamp = (index: number, at: number) => {
    const low = (cues[index - 1]?.at ?? -Infinity) + 0.05;
    const high = (cues[index + 1]?.at ?? Infinity) - 0.05;
    return Math.min(Math.max(at, Math.max(0, low)), Math.min(duration, high));
  };
  const timeAt = (clientX: number) => {
    const box = lane.current?.getBoundingClientRect();
    return box && box.width > 0 ? ((clientX - box.left) / box.width) * duration : 0;
  };
  const drag = (index: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const place = (moveEvent: PointerEvent | ReactPointerEvent) => clamp(index, moveEvent.altKey ? timeAt(moveEvent.clientX) : snapToBeat(timeAt(moveEvent.clientX), editing.beat));
    setDragging({ index, at: cues[index]!.at });
    const move = (moveEvent: PointerEvent) => setDragging({ index, at: place(moveEvent) });
    const up = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDragging(null);
      if (upEvent.type === "pointerup") editing.onMove(index, place(upEvent));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const nudge = (index: number) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!editing || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const step = event.shiftKey || !editing.beat ? 0.01 : 60 / editing.beat.tempo;
    editing.onMove(index, clamp(index, cues[index]!.at + (event.key === "ArrowLeft" ? -step : step)));
  };
  // A cue being dragged shows where it would go.
  const shown = dragging ? spans(cues.map((cue, i) => (i === dragging.index ? { ...cue, at: dragging.at } : cue)), sections, duration) : parts;

  return (
    <div ref={lane} className={cn("group/lane relative w-full", editing ? "h-8" : "h-6")} data-testid="stem-sections-lane">
      <nav className="absolute inset-x-0 top-0 h-6" aria-label={t("stems.sections")} data-testid="stem-sections">
        {shown.map((part) => {
          const isCurrent = part.index === current;
          return (
            <button
              key={`${part.index}-${part.cue.sectionId}`}
              type="button"
              disabled={!onSeek}
              onClick={() => onSeek?.(part.start)}
              className={cn(
                "absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-sm border border-background text-[11px] font-semibold transition-opacity",
                GROUP_TEXT[part.section.group],
                !isCurrent && "opacity-60 hover:opacity-90",
                isCurrent && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
              )}
              style={{ left: `${(part.start / duration) * 100}%`, width: `${((part.end - part.start) / duration) * 100}%`, background: GROUP_COLOURS[part.section.group] }}
              title={`${names.long(part.section)} · ${formatDuration(part.start)}`}
              aria-label={t("stems.goToSection", { name: names.long(part.section), time: formatDuration(part.start) })}
              aria-current={isCurrent ? "step" : undefined}
              data-testid="stem-section"
            >
              <span className="truncate px-0.5">{names.short(part.section)}</span>
            </button>
          );
        })}
      </nav>
      {editing
        ? shown.map((part) => {
            const active = dragging?.index === part.index;
            return (
              <button
                key={`handle-${part.index}`}
                type="button"
                onPointerDown={drag(part.index)}
                onKeyDown={nudge(part.index)}
                className={cn(
                  // Wide enough to take a finger; the grip itself thin, as an editor's in and out points.
                  "absolute top-0 z-10 flex h-8 w-4 -translate-x-1/2 cursor-ew-resize touch-none items-start justify-center outline-none",
                  "opacity-0 transition-opacity group-hover/lane:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
                  active && "opacity-100",
                )}
                style={{ left: `${(part.start / duration) * 100}%` }}
                aria-label={t("stems.cueHandle", { name: names.long(part.section), time: preciseTime(part.start) })}
                title={t("stems.cueHandleHint")}
                data-testid="stem-cue-handle"
                data-index={part.index}
              >
                <span className={cn("h-7 w-1 rounded-full bg-foreground shadow ring-2 ring-background", active && "w-1.5 bg-primary")} />
                {active ? (
                  <span className="pointer-events-none absolute top-8 rounded bg-foreground px-1 py-0.5 text-[10px] font-medium whitespace-nowrap text-background tabular-nums" data-testid="stem-cue-drag-time">
                    {preciseTime(part.start)}
                  </span>
                ) : null}
              </button>
            );
          })
        : null}
    </div>
  );
}

/** "1:02.35" from seconds. */
function preciseTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

/** Seconds from "1:02.35", "62.35" or "1:02"; null if it isn't a time. */
export function parseCueTime(text: string): number | null {
  const match = /^\s*(?:(\d+):)?(\d+(?:[.,]\d+)?)\s*$/.exec(text);
  if (!match) return null;
  const seconds = (match[1] ? Number(match[1]) * 60 : 0) + Number(match[2]!.replace(",", "."));
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Placing the sections on the recording (issue #110), in the stem player:
 * tap **Mark** as each section starts while it plays (the song's order, in
 * turn), or set one to the playhead, nudge it, type its time, and play from
 * it to check by ear. Snapped to the beat when the recording has a tempo.
 * Saved on every file of the multitrack.
 */
export function CueEditor({ song, cues, onChange, onClose }: { song: StemSong; cues: CuePoint[]; onChange: (cues: CuePoint[]) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const engine = useStems();
  const names = useCueNames();
  const sections = song.cueSections?.sections ?? [];
  const flow = song.cueSections?.flow ?? [];
  const [snap, setSnap] = useState(true);
  const [adding, setAdding] = useState(flow[0] ?? sections[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const beat = snap ? engine.beat : null;
  const nudgeBy = engine.beat ? 60 / engine.beat.tempo : 0.05;

  // The draft is the player's (issue #110): the lane's handles move the same cues as this list.
  const change = (next: CuePoint[]) => onChange([...next].sort((a, b) => a.at - b.at));

  const next = nextCueSection(flow, cues);
  const mark = () => {
    const sectionId = next ?? adding;
    if (sectionId) change([...cues.filter((cue) => Math.abs(cue.at - snapToBeat(engine.position, beat)) > 0.01), { at: snapToBeat(engine.position, beat), sectionId }]);
  };
  // M marks, as the button does, while the editor's open (not while typing).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() !== "m" || event.metaKey || event.ctrlKey || event.altKey || target?.closest('input:not([type="range"]):not([type="checkbox"]), textarea, select, [contenteditable]')) return;
      event.preventDefault();
      mark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Every file of the multitrack, its other takes too: they share them.
      const multitrackId = song.stems[0]?.multitrackId ?? null;
      const files = (song.record?.attachments ?? song.stems).filter((file) => file.type === "AUDIO" && file.stemPart && (file.multitrackId ?? null) === multitrackId && file.canChange);
      await Promise.all(files.map((file) => apiClient.updateAttachment(song.songVersionId, file.id, { cuePoints: cues })));
      song.record?.onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  const sectionOf = (id: string) => sections.find((section) => section.id === id);
  const nextSection = next ? sectionOf(next) : null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2 text-sm sm:p-3" data-testid="stem-cue-editor">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={mark} disabled={!nextSection && !adding} data-testid="stem-cue-mark" title={t("stems.cueMarkKey")}>
          <Flag />
          {nextSection ? t("stems.cueMark", { name: names.long(nextSection) }) : t("stems.cueMarkAgain")}
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">{preciseTime(engine.position)}</span>
        {engine.beat ? (
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} data-testid="stem-cue-snap" />
            {t("stems.cueSnap")}
          </label>
        ) : null}
        <span className="min-w-0 flex-1" />
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onClose} disabled={saving} aria-label={t("stems.cueClose")}>
          <X />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("stems.cueHint")}</p>
      {cues.length ? (
        <ol className="flex max-h-48 flex-col divide-y overflow-y-auto rounded-md border" data-testid="stem-cue-list">
          {cues.map((cue, index) => {
            const section = sectionOf(cue.sectionId);
            const move = (at: number) => change(cues.map((other, i) => (i === index ? { ...other, at: Math.max(0, at) } : other)));
            return (
              <li key={`${index}-${cue.sectionId}`} className="flex flex-wrap items-center gap-1.5 px-2 py-1" data-testid="stem-cue">
                <NativeSelect compact value={cue.sectionId} onChange={(event) => change(cues.map((other, i) => (i === index ? { ...other, sectionId: event.target.value } : other)))} aria-label={t("stems.cueSection")}>
                  {sections.map((option) => (
                    <option key={option.id} value={option.id}>
                      {names.long(option)}
                    </option>
                  ))}
                </NativeSelect>
                <TimeField key={cue.at} value={cue.at} label={t("stems.cueTime", { name: section ? names.long(section) : "" })} onChange={move} />
                <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => move(snapToBeat(cue.at - nudgeBy, null))} aria-label={t("stems.cueEarlier")} title={t("stems.cueEarlier")}>
                  <Minus />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => move(cue.at + nudgeBy)} aria-label={t("stems.cueLater")} title={t("stems.cueLater")}>
                  <Plus />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => move(snapToBeat(engine.position, beat))} aria-label={t("stems.cueToPlayhead")} title={t("stems.cueToPlayhead")}>
                  <Crosshair />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => {
                    seekStems(Math.max(0, cue.at - 1));
                    void playStems(song);
                  }}
                  aria-label={t("stems.cuePlayFrom")}
                  title={t("stems.cuePlayFrom")}
                >
                  <Play />
                </Button>
                <span className="min-w-0 flex-1" />
                <Button type="button" variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => change(cues.filter((_, i) => i !== index))} aria-label={t("stems.cueRemove")} title={t("stems.cueRemove")}>
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ol>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect compact value={adding} onChange={(event) => setAdding(event.target.value)} aria-label={t("stems.cueSection")} data-testid="stem-cue-add-section">
          {sections.map((option) => (
            <option key={option.id} value={option.id}>
              {names.long(option)}
            </option>
          ))}
        </NativeSelect>
        <Button type="button" variant="outline" size="sm" disabled={!adding} onClick={() => change([...cues, { at: snapToBeat(engine.position, beat), sectionId: adding }])} data-testid="stem-cue-add">
          <Plus />
          {t("stems.cueAddAtPlayhead")}
        </Button>
        <span className="min-w-0 flex-1" />
        {cues.length ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => change([])} disabled={saving}>
            {t("stems.cueClear")}
          </Button>
        ) : null}
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving} data-testid="stem-cue-save">
          {saving ? <Loader2 className="animate-spin" /> : null}
          {t("stems.cueSave")}
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A cue's time, typed ("1:02.35"): taken when it reads as one. */
function TimeField({ value, label, onChange }: { value: number; label: string; onChange: (seconds: number) => void }) {
  const [text, setText] = useState(preciseTime(value));
  const commit = () => {
    const seconds = parseCueTime(text);
    if (seconds === null) setText(preciseTime(value));
    else if (Math.abs(seconds - value) > 0.001) onChange(seconds);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      aria-label={label}
      className="h-7 w-20 rounded-md border bg-background px-1.5 text-xs tabular-nums"
      data-testid="stem-cue-time"
    />
  );
}
