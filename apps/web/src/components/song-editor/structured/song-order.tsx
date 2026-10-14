import { generateId, ID_PREFIXES, passChanged, transposeKey, type SectionInstance, type SectionV2 } from "@songverse/core";
import { ArrowLeft, ArrowRight, Copy, GripVertical, KeyRound, Link2, ListMinus, ListRestart, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@songverse/ui/components/popover";
import { cn } from "@songverse/ui/lib/utils";

const KEY_STEPS = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];
/** How long a finger rests on a pass before it can be dragged (a quicker swipe scrolls). */
const HOLD_MS = 350;

/**
 * The order the song is sung in (docs/song-document-v2.md, "Flow"), as a
 * strip of passes in their sections' colours (issue #251): dragged to
 * reorder (at once with a mouse, after a press and hold on a touch
 * screen); a pass chosen shows its actions in the bar under the strip -
 * earlier, later, sung again, duplicated, renamed, a key change, a note,
 * removed. The bar keeps its height whether a pass is chosen or not, and
 * its actions open over the page, so nothing moves under a finger.
 */
export function SongOrder({
  sections,
  flow,
  onChange,
  songKey,
  selected: selectedProp,
  onSelect,
  onDuplicateUnique,
}: {
  sections: SectionV2[];
  flow: SectionInstance[];
  onChange: (flow: SectionInstance[]) => void;
  songKey: string;
  /** The pass chosen, when the page keeps it (the editor: the pass being edited there); else the strip keeps its own. */
  selected?: string | null;
  onSelect?: (passId: string | null) => void;
  /** A pass's section duplicated as a section of its own, after it (the song editor; not an arrangement). */
  onDuplicateUnique?: (passId: string) => void;
}) {
  const { t } = useTranslation();
  const [own, setOwn] = useState<string | null>(null);
  const selected = selectedProp !== undefined ? selectedProp : own;
  const select = (passId: string | null) => (onSelect ? onSelect(passId) : setOwn(passId));
  const byId = new Map(sections.map((section) => [section.id, section]));
  const nameOf = (section: SectionV2) => section.label || t(`chart.sections.${section.type}`);
  const passes = flow.filter((item) => byId.has(item.sectionId));
  const plain = passes.length === sections.length && passes.every((item, i) => item.sectionId === sections[i]!.id && !item.label && !item.keyChange && !item.note && !passChanged(item));
  const unsung = sections.filter((section) => !passes.some((item) => item.sectionId === section.id));

  // The key in effect before each pass, for naming a key change.
  const keysBefore: (string | null)[] = [];
  let current: string | null = songKey || null;
  for (const item of passes) {
    keysBefore.push(current);
    if (item.keyChange) current = item.keyChange.key;
  }

  const index = passes.findIndex((item) => item.id === selected);
  const pass = index >= 0 ? passes[index]! : null;

  function add(sectionId: string) {
    const item = { id: generateId(ID_PREFIXES.flowItem), sectionId };
    onChange([...passes, item]);
    select(item.id);
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= passes.length || from === to) return;
    const next = [...passes];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  }
  function edit(change: Partial<SectionInstance>) {
    if (!pass) return;
    onChange(passes.map((item) => (item.id === pass.id ? { ...item, ...change } : item)));
  }

  const drag = usePassDrag(move);

  return (
    <div className="flex flex-col gap-2" data-testid="song-order">
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="mr-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("songOrder.title")}</h3>
        <ol className="contents" aria-label={t("songOrder.title")} ref={drag.list}>
          {passes.map((item, i) => {
            const section = byId.get(item.sectionId)!;
            // A section sung again: a linked copy of it (issue #205).
            const linked = passes.findIndex((one) => one.sectionId === item.sectionId) < i;
            return (
              <li key={item.id} data-pass-index={i}>
                <button
                  type="button"
                  aria-pressed={item.id === selected}
                  data-pass-section={section.type}
                  data-section-color={section.type}
                  onPointerDown={(event) => drag.start(event, i)}
                  onClick={() => {
                    if (drag.justDragged()) return;
                    select(item.id === selected ? null : item.id);
                  }}
                  className={cn(
                    "flex h-8 cursor-grab touch-manipulation items-center gap-1 rounded-full border border-[var(--section-line)] bg-[var(--section-tag)] pr-2.5 pl-1.5 text-xs font-medium whitespace-nowrap text-[var(--section-ink)] select-none pointer-coarse:h-11 pointer-coarse:pr-3.5",
                    "aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background",
                    drag.from === i && "opacity-40",
                    drag.to === i && drag.from !== i && "ring-2 ring-ring",
                  )}
                >
                  <GripVertical className="size-3 opacity-50" aria-hidden />
                  <span className="tabular-nums opacity-70">{i + 1}</span>
                  {linked ? <Link2 className="size-3" aria-label={t("linkedCopy.linked")} /> : null}
                  <span>{item.label || nameOf(section)}</span>
                  {item.keyChange ? <span className="rounded bg-background/60 px-1 font-mono text-[10px]">→{item.keyChange.key}</span> : null}
                  {item.note ? <MessageSquare className="size-3" aria-label={t("songOrder.hasNote")} /> : null}
                  {/* Its own chords, lines or words (issue #205). */}
                  {passChanged(item) ? (
                    <span className="font-semibold text-amber-600 dark:text-amber-400" title={t("songOrder.changed")} aria-label={t("songOrder.changed")} data-pass-changed="">
                      *
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
        <NativeSelect compact aria-label={t("songOrder.add")} value="" onChange={(event) => event.target.value && add(event.target.value)} className="h-8 w-auto rounded-full pointer-coarse:h-11">
          <option value="">{t("songOrder.addOption")}</option>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {nameOf(section)}
            </option>
          ))}
        </NativeSelect>
        {unsung.length > 0 ? <span className="text-xs text-muted-foreground">{t("songOrder.unsung", { sections: unsung.map(nameOf).join(", ") })}</span> : null}
        {/* Always there (disabled when the order already follows the sections): it never appears under a finger. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-8 text-xs pointer-coarse:h-11"
          disabled={plain}
          onClick={() => {
            onChange(sections.map((section) => ({ id: generateId(ID_PREFIXES.flowItem), sectionId: section.id })));
            select(null);
          }}
        >
          <ListRestart />
          {t("songOrder.reset")}
        </Button>
      </div>

      {/* The chosen pass's actions: one line that scrolls sideways if it must, the same height chosen or not. */}
      <div
        role="toolbar"
        aria-label={pass ? t("songOrder.pass", { n: index + 1, section: nameOf(byId.get(pass.sectionId)!) }) : t("songOrder.title")}
        className="@container/bar flex h-11 items-center gap-0.5 overflow-x-auto rounded-lg border bg-muted/40 px-1 pointer-coarse:h-14"
        data-testid="song-order-pass"
        data-pass={pass?.id}
      >
        {pass ? (
          <>
            {/* A fixed width: its number changing as the pass moves never moves the buttons beside it. */}
            <span className="w-36 shrink-0 truncate px-2 text-xs font-semibold whitespace-nowrap text-[var(--section-ink)] tabular-nums" data-section-color={byId.get(pass.sectionId)!.type}>
              {t("songOrder.pass", { n: index + 1, section: pass.label || nameOf(byId.get(pass.sectionId)!) })}
            </span>
            <BarButton label={t("songOrder.earlier")} disabled={index === 0} onClick={() => move(index, index - 1)} icon={<ArrowLeft />} />
            <BarButton label={t("songOrder.later")} disabled={index === passes.length - 1} onClick={() => move(index, index + 1)} icon={<ArrowRight />} />
            <BarButton
              label={t("songOrder.again")}
              onClick={() => {
                const copy = { id: generateId(ID_PREFIXES.flowItem), sectionId: pass.sectionId };
                onChange([...passes.slice(0, index + 1), copy, ...passes.slice(index + 1)]);
                select(copy.id);
              }}
              icon={<Link2 />}
            />
            {onDuplicateUnique ? <BarButton label={t("structuredEditor.duplicateSection")} onClick={() => onDuplicateUnique(pass.id)} icon={<Copy />} /> : null}
            <BarPopover label={t("songOrder.rename")} icon={<Pencil />} testId="pass-rename">
              <input
                aria-label={t("songOrder.label")}
                placeholder={t("songOrder.labelPlaceholder", { section: nameOf(byId.get(pass.sectionId)!) })}
                value={pass.label ?? ""}
                maxLength={100}
                onChange={(event) => edit({ label: event.target.value || null })}
                className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring pointer-coarse:h-11"
              />
            </BarPopover>
            <BarPopover label={t("songOrder.keyChange")} icon={<KeyRound />} testId="pass-key-change">
              <NativeSelect
                aria-label={t("songOrder.keyChange")}
                value={pass.keyChange?.steps ?? 0}
                onChange={(event) => {
                  const steps = Number(event.target.value);
                  const before = keysBefore[index];
                  edit({ keyChange: steps ? { steps, key: (before && transposeKey(before, steps)) || `${steps > 0 ? "+" : ""}${steps}` } : null });
                }}
                className="w-full pointer-coarse:h-11"
              >
                <option value={0}>{t("songOrder.sameKey")}</option>
                {KEY_STEPS.map((steps) => {
                  const before = keysBefore[index];
                  const key = before ? transposeKey(before, steps) : null;
                  return (
                    <option key={steps} value={steps}>
                      {`${steps > 0 ? "+" : ""}${steps}${key ? ` → ${key}` : ""}`}
                    </option>
                  );
                })}
              </NativeSelect>
            </BarPopover>
            <BarPopover label={t("songOrder.note")} icon={<MessageSquare />} testId="pass-note">
              <input
                aria-label={t("songOrder.note")}
                placeholder={t("songOrder.notePlaceholder")}
                value={pass.note ?? ""}
                maxLength={500}
                onChange={(event) => edit({ note: event.target.value || null })}
                className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring pointer-coarse:h-11"
              />
            </BarPopover>
            <span className="ml-auto" />
            {/* The section's only pass: removing it takes the section out of the order. */}
            <BarButton
              label={passes.filter((item) => item.sectionId === pass.sectionId).length > 1 ? t("songOrder.remove") : t("structuredEditor.takeOutOfOrder")}
              destructive
              onClick={() => {
                onChange(passes.filter((item) => item.id !== pass.id));
                select(null);
              }}
              icon={passes.filter((item) => item.sectionId === pass.sectionId).length > 1 ? <Trash2 /> : <ListMinus />}
            />
          </>
        ) : (
          <p className="truncate px-2 text-xs text-muted-foreground">{t("songOrder.hint")}</p>
        )}
      </div>
    </div>
  );
}

const barButton = "h-8 shrink-0 gap-1.5 px-2 text-xs pointer-coarse:h-11 pointer-coarse:px-3 [&_svg]:size-3.5";

/** One of the pass bar's actions: its icon, and its name when there's room (always its accessible name). */
function BarButton({ label, icon, onClick, disabled, destructive }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <Button type="button" variant="ghost" size="sm" className={cn(barButton, destructive && "text-destructive hover:text-destructive")} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {icon}
      <span className="hidden @4xl/bar:inline">{label}</span>
    </Button>
  );
}

/** An action of the pass bar that opens a small form over the page (its name, its key, its note). */
function BarPopover({ label, icon, testId, children }: { label: string; icon: ReactNode; testId: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" className={barButton} aria-label={label} title={label} data-testid={testId} />}>
        {icon}
        <span className="hidden @4xl/bar:inline">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Reordering the passes by dragging them (issue #251): with a mouse, once
 * it moves; on a touch screen, after a press and hold - a quick swipe
 * scrolls the page instead. The pass it's over takes its place on release.
 */
function usePassDrag(move: (from: number, to: number) => void) {
  const [state, setState] = useState<{ from: number; to: number } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const dragged = useRef(false);

  /** The pass under (or nearest to) a point. */
  function passAt(x: number, y: number): number | null {
    let best: { index: number; distance: number } | null = null;
    for (const li of list.current?.parentElement?.querySelectorAll<HTMLElement>("[data-pass-index]") ?? []) {
      const rect = li.getBoundingClientRect();
      const distance = Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
      if (!best || distance < best.distance) best = { index: Number(li.dataset.passIndex), distance };
    }
    return best?.index ?? null;
  }

  function start(event: ReactPointerEvent<HTMLElement>, from: number) {
    if (event.button !== 0) return;
    const origin = { x: event.clientX, y: event.clientY };
    const touch = event.pointerType !== "mouse";
    let active = false;
    let to = from;
    const begin = () => {
      active = true;
      dragged.current = true;
      setState({ from, to: from });
      if (touch) navigator.vibrate?.(10);
    };
    const timer = touch ? window.setTimeout(begin, HOLD_MS) : 0;
    const onMove = (e: PointerEvent) => {
      if (!active) {
        const distance = Math.hypot(e.clientX - origin.x, e.clientY - origin.y);
        // A finger moving before the hold scrolls; a mouse starts dragging once it moves.
        if (touch) {
          if (distance > 8) stop();
          return;
        }
        if (distance < 5) return;
        begin();
      }
      to = passAt(e.clientX, e.clientY) ?? to;
      setState({ from, to });
    };
    // Once dragging, a finger no longer scrolls the page.
    const onTouchMove = (e: TouchEvent) => {
      if (active) e.preventDefault();
    };
    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("touchmove", onTouchMove);
      setState(null);
    };
    const onUp = () => {
      const moved = active && to !== from;
      stop();
      if (moved) move(from, to);
      // The click that follows a drag isn't a choice.
      if (active) window.setTimeout(() => (dragged.current = false), 0);
    };
    dragged.current = false;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
  }

  return { list, start, from: state?.from ?? null, to: state?.to ?? null, justDragged: () => dragged.current };
}
