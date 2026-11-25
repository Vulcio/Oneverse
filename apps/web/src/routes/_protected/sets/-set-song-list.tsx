import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { RecentPlaysLine } from "#/components/recent-plays";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { degreeChords, formatDuration, formatTimer, SET_TRANSITIONS, TRANSPOSE_STEP_OPTIONS, transposeKey, type SetlistItem, type SetlistSongRef, type UpdateSetlistItemRequest } from "@oneverse/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, Check, ChevronDown, ChevronRight, GripVertical, Pencil, Text as TextIcon, Timer, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { apiClient } from "#/lib/api-client";
import { useMode } from "#/lib/mode";
import type { SetProgress } from "#/lib/set-progress";
import { setItemTitle, transposeLabel } from "#/lib/setlists";
import { TextItemDialog } from "@oneverse/planning/components/set-text-dialog";
import { PassageItemDialog } from "#/components/set-passage-item";
import { templateName } from "#/components/passage-template-select";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Input } from "@oneverse/ui/components/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@oneverse/ui/components/sheet";
import { cn } from "@oneverse/ui/lib/utils";
import { TransitionChordsPicker, TransitionSymbol, TransitionVariations } from "#/components/set-transition";

/** The key a song of the set is played in: its own, moved by its arrangement, then by the set. */
function playedKey(item: SetlistItem): string | null {
  const song = item.song;
  const baseKey = song?.key && item.arrangement ? (transposeKey(song.key, item.arrangement.transposeSteps) ?? song.key) : (song?.key ?? null);
  return baseKey ? (transposeKey(baseKey, item.transposeSteps) ?? baseKey) : null;
}

// The arrangement picker's "make one just for this set" choice.
const SET_ONLY = "__set";

/** Handing shared personal songs over to a team set's team (see SongOwnershipService in the API). */
export interface OwnershipActions {
  currentUserId: string;
  onRequest: (itemId: string) => void;
  onDecide: (requestId: string, accept: boolean) => void;
}

interface SetSongListProps {
  setlistId: string;
  items: SetlistItem[];
  /** Where it got to in Live (issue #153): the songs played marked. */
  progress?: SetProgress | null;
  canEdit: boolean;
  ownership: OwnershipActions;
  onReorder: (items: SetlistItem[]) => void;
  onChangeItem: (itemId: string, change: UpdateSetlistItemRequest) => void;
  onRemoveItem: (itemId: string) => void;
}

/** From this width the list is a table, its columns named; narrower (a phone), one line per song, its settings in a sheet. */
const TABLE_MIN_WIDTH = 720;

/** Whether the element is wide enough for the table: the table until it's measured (the server's render). */
function useWide(min: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWide((entry?.contentRect.width ?? min) >= min));
    observer.observe(element);
    return () => observer.disconnect();
  }, [min]);
  return { ref, wide };
}

export function SetSongList({ setlistId, items, progress, canEdit, ownership, onReorder, onChangeItem, onRemoveItem }: SetSongListProps) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const { ref, wide } = useWide(TABLE_MIN_WIDTH);

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    onReorder(arrayMove(items, from, to));
  }

  // The set's length: its songs' that say how long they are.
  const total = items.reduce((sum, item) => sum + (item.song?.durationSeconds ?? 0), 0);
  const rows = items.map((item, index) => (
    <SongRow
      key={item.id}
      setlistId={setlistId}
      item={item}
      ownership={ownership}
      index={index}
      next={items[index + 1] ?? null}
      played={!!progress?.played.includes(item.id)}
      current={progress?.current === item.id}
      canEdit={canEdit}
      wide={wide}
      onChange={(change) => onChangeItem(item.id, change)}
      onRemove={() => onRemoveItem(item.id)}
    />
  ));

  return (
    // A fixed id keeps dnd-kit's generated accessibility ids identical between server render and hydration.
    <DndContext id="set-song-list" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div ref={ref} className="min-w-0">
          {wide ? (
            // A running order (issue #497): its columns named, each value read as text until it's pointed at or tapped.
            <table className="w-full border-collapse text-sm" data-testid="set-song-list">
              <thead data-testid="set-song-columns">
                <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                  <th className="w-12 pb-1.5 font-medium" colSpan={canEdit ? 2 : 1}>
                    <span className="sr-only">#</span>
                  </th>
                  <th className="pb-1.5 font-medium">{t("sets.columns.song")}</th>
                  <th className="w-34 pb-1.5 pl-1.5 font-medium">{t("sets.columns.key")}</th>
                  <th className="w-16 pb-1.5 pl-1.5 font-medium">{t("sets.columns.tempo")}</th>
                  <th className="w-36 pb-1.5 pl-1.5 font-medium">{t("sets.columns.version")}</th>
                  <th className="w-40 pb-1.5 pl-1.5 font-medium">{t("sets.columns.then")}</th>
                  <th className="w-38 pb-1.5 pl-1.5 font-medium">{t("sets.columns.timer")}</th>
                  <th className="w-14 pb-1.5 text-right font-medium">{t("sets.columns.length")}</th>
                  {canEdit ? <th className="w-9 pb-1.5" /> : null}
                </tr>
              </thead>
              {rows}
              {total > 0 ? (
                <tfoot>
                  <tr className="text-xs text-muted-foreground">
                    <td colSpan={canEdit ? 9 : 8} className="pt-2 text-right tabular-nums" data-testid="set-total-length">
                      {t("sets.columns.total", { time: formatDuration(total) })}
                    </td>
                    {canEdit ? <td /> : null}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          ) : (
            <div className="flex flex-col gap-1">
              <ol className="flex flex-col divide-y" data-testid="set-song-list">
                {rows}
              </ol>
              {total > 0 ? (
                <p className="text-right text-xs text-muted-foreground tabular-nums" data-testid="set-total-length">
                  {t("sets.columns.total", { time: formatDuration(total) })}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function scopeLabel(song: SetlistSongRef, t: (key: string) => string): string {
  if (song.ownerScope === "GLOBAL") return t("sets.scopeGlobal");
  if (song.ownerScope === "TEAM") return song.teamName ?? "";
  return t("sets.scopePersonal");
}

/**
 * A setting in the table: plain text with a caret on hover (always on a
 * touch screen), the browser's own picker when it's opened; in the phone's
 * sheet, a normal select.
 */
function Pick({ ghost, label, value, onChange, disabled, testId, children }: { ghost: boolean; label: string; value: string | number; onChange: (event: ChangeEvent<HTMLSelectElement>) => void; disabled?: boolean; testId?: string; children: ReactNode }) {
  if (!ghost) {
    return (
      <NativeSelect aria-label={label} value={value} onChange={onChange} disabled={disabled} className="w-full text-sm" data-testid={testId}>
        {children}
      </NativeSelect>
    );
  }
  return (
    <span className="group/cell relative inline-flex w-full max-w-full items-center">
      <select
        aria-label={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
        data-testid={testId}
        className="h-7 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-transparent bg-transparent py-0 pr-5 pl-1.5 text-sm outline-none hover:border-input hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 size-3.5 text-muted-foreground opacity-0 group-focus-within/cell:opacity-100 group-hover/cell:opacity-100 [@media(any-hover:none)]:opacity-100" aria-hidden />
    </span>
  );
}

function SongRow({
  setlistId,
  item,
  ownership,
  index,
  next,
  played,
  current,
  canEdit,
  wide,
  onChange,
  onRemove,
}: {
  setlistId: string;
  item: SetlistItem;
  ownership: OwnershipActions;
  index: number;
  /** The item after it; null at the end of the set. */
  next: SetlistItem | null;
  played: boolean;
  current: boolean;
  canEdit: boolean;
  /** A row of the table, or a line of the phone's list. */
  wide: boolean;
  onChange: (change: UpdateSetlistItemRequest) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canEdit,
  });
  const navigate = useNavigate();
  const { mode } = useMode();
  const [customizing, setCustomizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const song = item.song;
  const title = setItemTitle(item, t);
  // Slides of text (issue #305): its title, opened to change.
  const text = item.text ?? null;
  const [editingText, setEditingText] = useState(false);
  // A Bible passage (issue #301): its reference, opened to change.
  const passage = item.passage ?? null;
  const [editingPassage, setEditingPassage] = useState(false);

  // Its own arrangement for this set, opened to change.
  async function customize() {
    if (!song) return;
    setCustomizing(true);
    setError(null);
    try {
      const { arrangementId } = await apiClient.createSetArrangement(setlistId, item.id, t("sets.justThisSet"));
      await navigate({ to: "/library/$songVersionId/arrangements/$arrangementId", params: { songVersionId: song.id, arrangementId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCustomizing(false);
    }
  }
  // The item's own key goes on top of the arrangement's.
  const baseKey = song?.key && item.arrangement ? (transposeKey(song.key, item.arrangement.transposeSteps) ?? song.key) : (song?.key ?? null);
  const fromKey = song ? playedKey(item) : null;
  const nextKey = next ? playedKey(next) : null;
  const nextFirstChord = next?.edgeChords?.first ?? null;
  const hasNext = !!next;
  // The chords into the next song (issue #10) are offered between two songs, until something else is said to happen there.
  const offersChords = canEdit && !!song && !!next?.song && (!item.transition || item.transition === "TRANSITION");
  const pickChords = (transitionChords: string[]) =>
    onChange(item.transition === "TRANSITION" || transitionChords.length === 0 ? { transitionChords } : { transition: "TRANSITION", transitionChords });
  const keyChanges = hasNext && fromKey && nextKey && fromKey !== nextKey && (!item.transition || item.transition === "TRANSITION" || item.transition === "SEGUE");
  const tempo = item.tempoOverride ?? song?.tempo ?? null;
  const versionLabel = item.arrangement ? (item.arrangement.setOnly ? t("sets.justThisSet") : item.arrangement.name) : t("sets.asWritten");
  const toLink = mode === "live" ? "/sets/$setlistId/live/$itemId" : "/sets/$setlistId/songs/$itemId";

  const handle = canEdit ? (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={t("sets.dragToReorder", { title })}
      className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
    >
      <GripVertical className="size-4" />
    </button>
  ) : null;

  // Played through in Live (issue #153): a tick; the last song opened there, where Live picks up, highlighted.
  const number = (
    <span
      className={`flex items-center justify-end gap-0.5 text-sm tabular-nums ${current ? "font-semibold text-primary" : "text-muted-foreground"}`}
      data-testid="set-song-number"
      data-played={played || undefined}
      data-current={current || undefined}
      title={[played ? t("sets.played") : null, current ? t("sets.lastPlayed") : null].filter(Boolean).join(" · ") || undefined}
    >
      {played ? <Check className="size-3.5 shrink-0" aria-label={t("sets.played")} /> : null}
      {index + 1}
    </span>
  );

  const titleBlock = (
    <div className="flex min-w-0 flex-col gap-0.5">
      {song ? (
        <Link to={toLink} params={{ setlistId, itemId: item.id }} className="font-medium hover:underline">
          {song.title}
          {song.versionName ? <span className="font-normal text-muted-foreground"> — {song.versionName}</span> : null}
        </Link>
      ) : text ? (
        <span className="flex items-center gap-1.5" data-testid="set-text-row">
          <TextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Link to={toLink} params={{ setlistId, itemId: item.id }} className="font-medium hover:underline">
            {title}
          </Link>
          {canEdit ? (
            <Button variant="ghost" size="icon" className="size-7" aria-label={t("sets.text.edit", { title })} onClick={() => setEditingText(true)}>
              <Pencil />
            </Button>
          ) : null}
        </span>
      ) : passage ? (
        <span className="flex items-center gap-1.5" data-testid="set-passage-row">
          <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Link to={toLink} params={{ setlistId, itemId: item.id }} className="font-medium hover:underline">
            {title}
          </Link>
          {passage.template ? (
            <span className="text-xs text-muted-foreground" data-testid="set-passage-template">
              {templateName(passage.template, t)}
            </span>
          ) : null}
          {canEdit ? (
            <Button variant="ghost" size="icon" className="size-7" aria-label={t("sets.passage.edit", { title })} onClick={() => setEditingPassage(true)}>
              <Pencil />
            </Button>
          ) : null}
        </span>
      ) : (
        <span className="text-sm italic text-muted-foreground">{title}</span>
      )}
      {passage && editingPassage ? (
        <PassageItemDialog open={editingPassage} onOpenChange={setEditingPassage} passage={passage} onSave={async (changed, screenTemplate) => onChange({ passage: changed, screenTemplate })} />
      ) : null}
      {text && editingText ? <TextItemDialog open={editingText} onOpenChange={setEditingText} text={text} onSave={async (changed) => onChange({ text: changed })} /> : null}
      {item.songbookReferences.length > 0 ? (
        <span className="text-xs text-muted-foreground" data-testid="set-song-references">
          {item.songbookReferences.join(", ")}
        </span>
      ) : null}
      {/* How often it was played in the team's sets lately (issue #335). */}
      <RecentPlaysLine plays={item.recentPlays} />
      <OwnershipLine item={item} ownership={ownership} />
      {error ? (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );

  // Which song, when it has translations: with the song, not a column of its own.
  const translationPicker = (ghost: boolean) =>
    song && canEdit && item.versions.length > 1 ? (
      <Pick ghost={ghost} label={t("sets.version")} value={song.id} onChange={(event) => onChange({ songVersionId: event.target.value })}>
        {item.versions.map((version) => (
          <option key={version.id} value={version.id}>
            {version.versionName ? `${version.title} — ${version.versionName}` : version.title} · {scopeLabel(version, t)}
          </option>
        ))}
      </Pick>
    ) : null;

  const versionCell = (ghost: boolean) =>
    song && canEdit && (item.arrangements.length > 0 || item.inLibrary) ? (
      <span className="flex min-w-0 items-center gap-0.5">
        <Pick
          ghost={ghost}
          label={t("sets.arrangement")}
          value={item.arrangement?.id ?? ""}
          disabled={customizing}
          onChange={(event) => {
            if (event.target.value === SET_ONLY) void customize();
            else onChange({ arrangementId: event.target.value || null });
          }}
        >
          <option value="">{t("sets.asWritten")}</option>
          {item.arrangements.map((arrangement) => (
            <option key={arrangement.id} value={arrangement.id}>
              {arrangement.setOnly ? t("sets.justThisSet") : arrangement.isTeamDefault ? t("sets.usualArrangement", { name: arrangement.name }) : arrangement.name}
            </option>
          ))}
          {/* Reorder, skip or repeat its sections just for this set (#16). */}
          {item.inLibrary && !item.arrangements.some((arrangement) => arrangement.setOnly) ? <option value={SET_ONLY}>{t("sets.newJustThisSet")}</option> : null}
        </Pick>
        {item.arrangement?.setOnly ? (
          <Button variant="ghost" size="icon" className="size-7 shrink-0" render={<Link to="/library/$songVersionId/arrangements/$arrangementId" params={{ songVersionId: song.id, arrangementId: item.arrangement.id }} aria-label={t("sets.editJustThisSet", { title })} />}>
            <Pencil />
          </Button>
        ) : null}
      </span>
    ) : song ? (
      <span className="block truncate pl-1.5 leading-7 text-muted-foreground">{item.arrangement ? t("sets.playedAs", { name: item.arrangement.name }) : t("sets.asWritten")}</span>
    ) : null;

  const keyCell = (ghost: boolean) =>
    song && canEdit ? (
      <Pick ghost={ghost} label={t("sets.key")} value={item.transposeSteps} onChange={(event) => onChange({ transposeSteps: Number(event.target.value) })}>
        {TRANSPOSE_STEP_OPTIONS.map((steps) => (
          <option key={steps} value={steps}>
            {transposeLabel(baseKey, steps, t)}
          </option>
        ))}
      </Pick>
    ) : song ? (
      <span className="block pl-1.5 leading-7 text-muted-foreground">{transposeLabel(baseKey, item.transposeSteps, t)}</span>
    ) : null;

  // The set's own tempo (issue #382): typed, the song's when it's put back or left empty.
  const tempoCell = (ghost: boolean) =>
    song && canEdit ? (
      <input
        key={`${item.tempoOverride ?? ""}`}
        type="number"
        inputMode="numeric"
        min={20}
        max={300}
        defaultValue={tempo ?? ""}
        placeholder={song.tempo ? String(Math.round(song.tempo)) : "—"}
        aria-label={t("sets.columns.tempoLabel")}
        data-testid="set-song-tempo"
        className={cn(
          "h-7 w-full min-w-0 rounded-md border bg-transparent px-1.5 text-sm tabular-nums outline-none [appearance:textfield] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-inner-spin-button]:appearance-none",
          ghost ? "border-transparent hover:border-input hover:bg-muted/40" : "h-9 border-input",
        )}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        onBlur={(event) => {
          const typed = event.target.value.trim() ? Math.round(Number(event.target.value)) : null;
          const wanted = typed === null || (song.tempo && typed === Math.round(song.tempo)) ? null : typed;
          if (wanted !== null && (!Number.isFinite(wanted) || wanted < 20 || wanted > 300)) {
            event.target.value = tempo ? String(tempo) : "";
            return;
          }
          if (wanted !== (item.tempoOverride ?? null)) onChange({ tempoOverride: wanted });
        }}
      />
    ) : tempo ? (
      <span className="block pl-1.5 leading-7 text-muted-foreground tabular-nums">{Math.round(tempo)}</span>
    ) : null;

  // What happens after it (issue #199).
  const thenCell = (ghost: boolean) =>
    canEdit && (hasNext || item.transition) ? (
      <Pick ghost={ghost} label={t("sets.afterThisSong")} value={item.transition ?? ""} onChange={(event) => onChange({ transition: (event.target.value || null) as UpdateSetlistItemRequest["transition"] })} testId="set-song-transition">
        <option value="">{ghost ? "—" : t("sets.transitions.none")}</option>
        {SET_TRANSITIONS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`sets.transitions.${kind}`)}
          </option>
        ))}
      </Pick>
    ) : item.transition ? (
      <span className="flex items-center gap-1 pl-1.5 leading-7 text-muted-foreground">
        <TransitionSymbol kind={item.transition} />
        {t(`sets.transitions.${item.transition}`)}
      </span>
    ) : !hasNext ? (
      <span className="block pl-1.5 leading-7 text-muted-foreground">{t("sets.columns.end")}</span>
    ) : null;

  // Its own timer (issue #269): started on the screens when Live comes to it.
  const timerCell = (ghost: boolean) =>
    canEdit ? (
      <Pick ghost={ghost} label={t("sets.timer")} value={timerValue(item.timer)} onChange={(event) => onChange({ timer: timerFrom(event.target.value) })} testId="set-song-timer">
        <option value="">{ghost ? "—" : t("sets.timerNone")}</option>
        <option value="up">{t("sets.timerUp")}</option>
        {ITEM_TIMER_MINUTES.map((minutes) => (
          <option key={minutes} value={String(minutes * 60)}>
            {t("sets.timerDown", { time: formatTimer(minutes * 60) })}
          </option>
        ))}
        {item.timer?.kind === "countdown" && !ITEM_TIMER_MINUTES.includes(item.timer.duration / 60) ? <option value={String(item.timer.duration)}>{t("sets.timerDown", { time: formatTimer(item.timer.duration) })}</option> : null}
      </Pick>
    ) : item.timer ? (
      <span className="flex items-center gap-1 pl-1.5 leading-7 text-muted-foreground">
        <Timer className="size-3.5" aria-hidden />
        {item.timer.kind === "count-up" ? t("sets.timerUp") : t("sets.timerDown", { time: formatTimer(item.timer.duration) })}
      </span>
    ) : null;

  // Into the next song: a transition's chords and note, or chords offered where nothing is said yet; the key change.
  const intoNext =
    hasNext && (offersChords || item.transition === "TRANSITION" || keyChanges) ? (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground" data-testid="set-song-after">
        {offersChords ? (
          <>
            <TransitionChordsPicker fromKey={fromKey} toKey={nextKey} lastChord={item.edgeChords?.last ?? null} firstChord={nextFirstChord} degrees={item.transitionChords ?? []} onChange={pickChords} className="h-7" />
            <TransitionVariations fromKey={fromKey} toKey={nextKey} lastChord={item.edgeChords?.last ?? null} firstChord={nextFirstChord} degrees={item.transitionChords ?? []} onChange={pickChords} />
          </>
        ) : item.transition === "TRANSITION" && item.transitionChords?.length ? (
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">{nextKey ? degreeChords(item.transitionChords, nextKey).join(" ") : item.transitionChords.join(" ")}</span>
        ) : null}
        {item.transition === "TRANSITION" ? (
          canEdit ? (
            <Input
              key={item.transitionNote ?? ""}
              defaultValue={item.transitionNote ?? ""}
              maxLength={200}
              placeholder={t("sets.transitionNote")}
              aria-label={t("sets.transitionNote")}
              className="h-7 w-56 max-w-full text-sm"
              onBlur={(event) => event.target.value.trim() !== (item.transitionNote ?? "") && onChange({ transitionNote: event.target.value })}
              data-testid="set-song-transition-note"
            />
          ) : item.transitionNote ? (
            <span>{item.transitionNote}</span>
          ) : null
        ) : null}
        {keyChanges ? <span data-testid="set-song-key-change">{t("sets.keyChange", { from: fromKey, to: nextKey })}</span> : null}
      </div>
    ) : null;

  const length = song?.durationSeconds ? formatDuration(song.durationSeconds) : null;
  const removeButton = canEdit ? (
    <Button variant="ghost" size="icon" className="size-7" aria-label={t("sets.removeSong", { title })} onClick={onRemove}>
      <X />
    </Button>
  ) : null;
  // Moved, never stretched: rows of different heights would otherwise be scaled to the one they pass over.
  const style = { transform: CSS.Translate.toString(transform), transition };

  if (wide) {
    return (
      <tbody ref={setNodeRef} style={style} className={cn("border-b bg-card last-of-type:border-b-0", isDragging && "relative z-10 opacity-80 shadow-md")} data-testid="set-song-row">
        <tr className="align-top">
          {canEdit ? <td className="w-7 py-2 pr-0">{handle}</td> : null}
          <td className="w-7 py-2.5 pr-2">{number}</td>
          <td className="pt-2.5 pb-2 pr-3">
            {titleBlock}
            {translationPicker(true) ? <div className="mt-1 max-w-64">{translationPicker(true)}</div> : null}
          </td>
          <td className="py-2 pr-2">{keyCell(true)}</td>
          <td className="py-2 pr-2">{tempoCell(true)}</td>
          <td className="max-w-36 py-2 pr-2">{versionCell(true)}</td>
          <td className="py-2 pr-2">{thenCell(true)}</td>
          <td className="py-2 pr-2">{timerCell(true)}</td>
          <td className="py-2 text-right leading-7 text-muted-foreground tabular-nums">{length}</td>
          {canEdit ? <td className="py-1.5 text-right">{removeButton}</td> : null}
        </tr>
        {intoNext ? (
          <tr>
            <td colSpan={canEdit ? 2 : 1} />
            <td colSpan={canEdit ? 8 : 7} className="pb-2">
              {intoNext}
            </td>
          </tr>
        ) : null}
      </tbody>
    );
  }

  // A phone: one line of values under the title; a tap on the arrow opens its settings.
  const summary = [song ? transposeLabel(baseKey, item.transposeSteps, t) : null, tempo ? `${Math.round(tempo)} BPM` : null, song ? versionLabel : null, length].filter(Boolean).join(" · ");
  return (
    <li ref={setNodeRef} style={style} className={cn("flex flex-col gap-1 bg-card py-2", isDragging && "relative z-10 opacity-80 shadow-md")} data-testid="set-song-row">
      <div className="flex items-center gap-2">
        {handle}
        <span className="w-6 shrink-0">{number}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          {titleBlock}
          {summary ? <span className="truncate text-xs text-muted-foreground" data-testid="set-song-summary">{summary}</span> : null}
        </div>
        {canEdit ? (
          <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label={t("sets.changeItem", { title })} onClick={() => setSheetOpen(true)} data-testid="set-song-open">
            <ChevronRight />
          </Button>
        ) : null}
      </div>
      {item.transition && hasNext ? (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-8 text-xs text-muted-foreground" data-testid="set-song-then">
          <span className="flex items-center gap-1 whitespace-nowrap">
            <TransitionSymbol kind={item.transition} />
            {t(`sets.transitions.${item.transition}`)}
          </span>
          {item.transitionChords?.length ? <span className="font-medium whitespace-nowrap text-foreground">{nextKey ? degreeChords(item.transitionChords, nextKey).join(" ") : item.transitionChords.join(" ")}</span> : null}
          {keyChanges ? <span className="whitespace-nowrap">{t("sets.keyChange", { from: fromKey, to: nextKey })}</span> : null}
          {item.transitionNote ? <span className="min-w-0 truncate">“{item.transitionNote}”</span> : null}
        </span>
      ) : null}
      {canEdit ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="set-song-sheet">
            <SheetHeader className="pb-0">
              <SheetTitle>
                {index + 1}. {title}
              </SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-3 px-4">
              {translationPicker(false) ? <Field label={t("sets.version")}>{translationPicker(false)}</Field> : null}
              {song ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("sets.columns.key")}>{keyCell(false)}</Field>
                  <Field label={t("sets.columns.tempoLabel")}>{tempoCell(false)}</Field>
                  <Field label={t("sets.columns.version")}>{versionCell(false)}</Field>
                  <Field label={t("sets.columns.timer")}>{timerCell(false)}</Field>
                </div>
              ) : (
                <Field label={t("sets.columns.timer")}>{timerCell(false)}</Field>
              )}
              {hasNext ? (
                <div className="flex flex-col gap-2 border-t pt-3">
                  <Field label={next?.song ? t("sets.intoNext", { title: setItemTitle(next, t) }) : t("sets.afterThisSong")}>{thenCell(false)}</Field>
                  {intoNext}
                </div>
              ) : null}
              <Button variant="ghost" className="self-start text-destructive" onClick={() => { setSheetOpen(false); onRemove(); }}>
                <X />
                {t("sets.removeFromSet")}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** The lengths a set item's countdown is picked from (minutes). */
const ITEM_TIMER_MINUTES = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
const timerValue = (timer: SetlistItem["timer"]) => (!timer ? "" : timer.kind === "count-up" ? "up" : String(timer.duration));
const timerFrom = (value: string): UpdateSetlistItemRequest["timer"] => (!value ? null : value === "up" ? { kind: "count-up", duration: 0 } : { kind: "countdown", duration: Number(value) });

/** "Shared by …" and, for a team set, asking for / handing over / deciding on the song. */
function OwnershipLine({ item, ownership }: { item: SetlistItem; ownership: OwnershipActions }) {
  const { t } = useTranslation();
  if (!item.sharedBy && !item.ownershipRequest) return null;
  const sharedByMe = item.sharedBy?.id === ownership.currentUserId;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {item.sharedBy ? (
        <Badge variant="muted">{sharedByMe ? t("sets.sharedByYou") : t("sets.sharedBy", { name: item.sharedBy.displayName })}</Badge>
      ) : null}
      {item.ownershipRequest?.canDecide ? (
        <>
          <span className="text-xs text-muted-foreground">{t("sets.teamAskedForYourSong")}</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => ownership.onDecide(item.ownershipRequest!.id, true)}>
            {t("sets.accept")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => ownership.onDecide(item.ownershipRequest!.id, false)}>
            {t("sets.decline")}
          </Button>
        </>
      ) : item.ownershipRequest ? (
        <Badge variant="warning">{t("sets.requested")}</Badge>
      ) : item.canRequestOwnership ? (
        <Button size="sm" variant="outline" className="h-7" onClick={() => ownership.onRequest(item.id)}>
          {sharedByMe ? t("sets.giveToTeam") : t("sets.askForSong")}
        </Button>
      ) : null}
    </div>
  );
}
