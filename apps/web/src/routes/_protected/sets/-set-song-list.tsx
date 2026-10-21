import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { degreeChords, formatTimer, SET_TRANSITIONS, TRANSPOSE_STEP_OPTIONS, transposeKey, type SetlistItem, type SetlistSongRef, type UpdateSetlistItemRequest } from "@oneverse/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, GripVertical, Pencil, Text as TextIcon, Timer, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { apiClient } from "#/lib/api-client";
import { useMode } from "#/lib/mode";
import type { SetProgress } from "#/lib/set-progress";
import { setItemTitle, transposeLabel } from "#/lib/setlists";
import { TextItemDialog } from "#/components/set-text-item";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Input } from "@oneverse/ui/components/input";
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

export function SetSongList({ setlistId, items, progress, canEdit, ownership, onReorder, onChangeItem, onRemoveItem }: SetSongListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    onReorder(arrayMove(items, from, to));
  }

  return (
    // A fixed id keeps dnd-kit's generated accessibility ids identical between server render and hydration.
    <DndContext id="set-song-list" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col divide-y" data-testid="set-song-list">
          {items.map((item, index) => (
            <SongRow
              key={item.id}
              setlistId={setlistId}
              item={item}
              ownership={ownership}
              index={index}
              hasNext={index < items.length - 1}
              nextKey={items[index + 1] ? playedKey(items[index + 1]!) : null}
              nextFirstChord={items[index + 1]?.edgeChords?.first ?? null}
              played={!!progress?.played.includes(item.id)}
              current={progress?.current === item.id}
              canEdit={canEdit}
              onChange={(change) => onChangeItem(item.id, change)}
              onRemove={() => onRemoveItem(item.id)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function scopeLabel(song: SetlistSongRef, t: (key: string) => string): string {
  if (song.ownerScope === "GLOBAL") return t("sets.scopeGlobal");
  if (song.ownerScope === "TEAM") return song.teamName ?? "";
  return t("sets.scopePersonal");
}

function SongRow({
  setlistId,
  item,
  ownership,
  index,
  hasNext,
  nextKey,
  nextFirstChord,
  played,
  current,
  canEdit,
  onChange,
  onRemove,
}: {
  setlistId: string;
  item: SetlistItem;
  ownership: OwnershipActions;
  index: number;
  hasNext: boolean;
  /** The key the next song is played in; null at the end of the set, or without one. */
  nextKey: string | null;
  /** The next song's first chord as played, where a transition leads (issue #217). */
  nextFirstChord: string | null;
  played: boolean;
  current: boolean;
  canEdit: boolean;
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
  const song = item.song;
  const title = setItemTitle(item, t);
  // Slides of text (issue #305): its title, opened to change.
  const text = item.text ?? null;
  const [editingText, setEditingText] = useState(false);

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

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap items-center gap-3 bg-card py-2 first:pt-0 last:pb-0 ${isDragging ? "relative z-10 opacity-80 shadow-md" : ""}`}
      data-testid="set-song-row"
    >
      {canEdit ? (
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
      ) : null}
      {/* Played through in Live (issue #153): a tick; the last song opened there, where Live picks up, highlighted. */}
      <span
        className={`flex w-10 items-center justify-end gap-0.5 text-sm tabular-nums ${current ? "font-semibold text-primary" : "text-muted-foreground"}`}
        data-testid="set-song-number"
        data-played={played || undefined}
        data-current={current || undefined}
        title={[played ? t("sets.played") : null, current ? t("sets.lastPlayed") : null].filter(Boolean).join(" · ") || undefined}
      >
        {played ? <Check className="size-3.5 shrink-0" aria-label={t("sets.played")} /> : null}
        {index + 1}.
      </span>
      {/* Wide enough to read; the controls wrap below it on a narrow screen. */}
      <div className="flex min-w-40 flex-1 flex-col gap-1">
        {song ? (
          <Link
            // Live opens it full screen.
            to={mode === "live" ? "/sets/$setlistId/live/$itemId" : "/sets/$setlistId/songs/$itemId"}
            params={{ setlistId, itemId: item.id }}
            className="font-medium hover:underline"
          >
            {song.title}
            {song.versionName ? <span className="font-normal text-muted-foreground"> — {song.versionName}</span> : null}
          </Link>
        ) : text ? (
          <span className="flex items-center gap-1.5" data-testid="set-text-row">
            <TextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Link to={mode === "live" ? "/sets/$setlistId/live/$itemId" : "/sets/$setlistId/songs/$itemId"} params={{ setlistId, itemId: item.id }} className="font-medium hover:underline">
              {title}
            </Link>
            {canEdit ? (
              <Button variant="ghost" size="icon" className="size-7" aria-label={t("sets.text.edit", { title })} onClick={() => setEditingText(true)}>
                <Pencil />
              </Button>
            ) : null}
          </span>
        ) : (
          <span className="text-sm italic text-muted-foreground">{title}</span>
        )}
        {text && editingText ? (
          <TextItemDialog open={editingText} onOpenChange={setEditingText} text={text} onSave={async (changed) => onChange({ text: changed })} />
        ) : null}
        {item.songbookReferences.length > 0 ? (
          <span className="text-xs text-muted-foreground" data-testid="set-song-references">
            {item.songbookReferences.join(", ")}
          </span>
        ) : null}
        {item.arrangement && !canEdit ? (
          <span className="text-xs text-muted-foreground">{t("sets.playedAs", { name: item.arrangement.name })}</span>
        ) : null}
        <OwnershipLine item={item} ownership={ownership} />
        {error ? (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </div>

      {song && canEdit && item.versions.length > 1 ? (
        <NativeSelect
          aria-label={t("sets.version")}
          value={song.id}
          onChange={(event) => onChange({ songVersionId: event.target.value })}
          compact
          className="max-w-56 text-sm"
        >
          {item.versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.versionName ? `${version.title} — ${version.versionName}` : version.title} · {scopeLabel(version, t)}
            </option>
          ))}
        </NativeSelect>
      ) : null}

      {song && canEdit && (item.arrangements.length > 0 || item.inLibrary) ? (
        <span className="flex items-center gap-0.5">
          <NativeSelect
            aria-label={t("sets.arrangement")}
            value={item.arrangement?.id ?? ""}
            disabled={customizing}
            onChange={(event) => {
              if (event.target.value === SET_ONLY) void customize();
              else onChange({ arrangementId: event.target.value || null });
            }}
            compact
            className="max-w-56 text-sm"
          >
            <option value="">{t("sets.asWritten")}</option>
            {item.arrangements.map((arrangement) => (
              <option key={arrangement.id} value={arrangement.id}>
                {arrangement.setOnly
                  ? t("sets.justThisSet")
                  : arrangement.isTeamDefault
                    ? t("sets.usualArrangement", { name: arrangement.name })
                    : arrangement.name}
              </option>
            ))}
            {/* Reorder, skip or repeat its sections just for this set (#16). */}
            {item.inLibrary && !item.arrangements.some((arrangement) => arrangement.setOnly) ? (
              <option value={SET_ONLY}>{t("sets.newJustThisSet")}</option>
            ) : null}
          </NativeSelect>
          {item.arrangement?.setOnly ? (
            <Button variant="ghost" size="icon" className="size-8" render={<Link to="/library/$songVersionId/arrangements/$arrangementId" params={{ songVersionId: song.id, arrangementId: item.arrangement.id }} aria-label={t("sets.editJustThisSet", { title })} />}>
                <Pencil />
              </Button>
          ) : null}
        </span>
      ) : null}

      {song && canEdit ? (
        <NativeSelect
          aria-label={t("sets.key")}
          value={item.transposeSteps}
          onChange={(event) => onChange({ transposeSteps: Number(event.target.value) })}
          compact
          className="text-sm"
        >
          {TRANSPOSE_STEP_OPTIONS.map((steps) => (
            <option key={steps} value={steps}>
              {transposeLabel(baseKey, steps, t)}
            </option>
          ))}
        </NativeSelect>
      ) : song ? (
        <span className="text-sm text-muted-foreground">{transposeLabel(baseKey, item.transposeSteps, t)}</span>
      ) : null}

      {/* What happens after it (issue #199): to choose, or shown; a transition's note beside it. */}
      {canEdit ? (
        <span className="flex items-center gap-1">
          <NativeSelect
            aria-label={t("sets.afterThisSong")}
            value={item.transition ?? ""}
            onChange={(event) => onChange({ transition: (event.target.value || null) as UpdateSetlistItemRequest["transition"] })}
            compact
            className="text-sm"
            data-testid="set-song-transition"
          >
            <option value="">{t("sets.transitions.none")}</option>
            {SET_TRANSITIONS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`sets.transitions.${kind}`)}
              </option>
            ))}
          </NativeSelect>
          {item.transition === "TRANSITION" && hasNext ? (
            <Input
              key={item.transitionNote ?? ""}
              defaultValue={item.transitionNote ?? ""}
              maxLength={200}
              placeholder={t("sets.transitionNote")}
              aria-label={t("sets.transitionNote")}
              className="h-8 w-44 text-sm"
              onBlur={(event) => event.target.value.trim() !== (item.transitionNote ?? "") && onChange({ transitionNote: event.target.value })}
              data-testid="set-song-transition-note"
            />
          ) : null}
          {/* The chords played into the next song (issue #10): a song's. */}
          {item.transition === "TRANSITION" && hasNext && song ? (
            <>
              <TransitionChordsPicker fromKey={song ? playedKey(item) : null} toKey={nextKey} lastChord={item.edgeChords?.last ?? null} firstChord={nextFirstChord} degrees={item.transitionChords ?? []} onChange={(transitionChords) => onChange({ transitionChords })} />
              <TransitionVariations fromKey={song ? playedKey(item) : null} toKey={nextKey} lastChord={item.edgeChords?.last ?? null} firstChord={nextFirstChord} degrees={item.transitionChords ?? []} onChange={(transitionChords) => onChange({ transitionChords })} />
            </>
          ) : null}
        </span>
      ) : item.transition ? (
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          <TransitionSymbol kind={item.transition} />
          {t(`sets.transitions.${item.transition}`)}
          {item.transitionNote ? ` · ${item.transitionNote}` : ""}
          {item.transitionChords?.length ? ` · ${nextKey ? degreeChords(item.transitionChords, nextKey).join(" ") : item.transitionChords.join(" ")}` : ""}
        </span>
      ) : null}

      {/* Its own timer (issue #269): started on the screens when Live comes to it. */}
      {canEdit ? (
        <NativeSelect
          aria-label={t("sets.timer")}
          value={timerValue(item.timer)}
          onChange={(event) => onChange({ timer: timerFrom(event.target.value) })}
          compact
          className="text-sm"
          data-testid="set-song-timer"
        >
          <option value="">{t("sets.timerNone")}</option>
          <option value="up">{t("sets.timerUp")}</option>
          {ITEM_TIMER_MINUTES.map((minutes) => (
            <option key={minutes} value={String(minutes * 60)}>
              {t("sets.timerDown", { time: formatTimer(minutes * 60) })}
            </option>
          ))}
          {item.timer?.kind === "countdown" && !ITEM_TIMER_MINUTES.includes(item.timer.duration / 60) ? <option value={String(item.timer.duration)}>{t("sets.timerDown", { time: formatTimer(item.timer.duration) })}</option> : null}
        </NativeSelect>
      ) : item.timer ? (
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          <Timer className="size-3.5" aria-hidden />
          {item.timer.kind === "count-up" ? t("sets.timerUp") : t("sets.timerDown", { time: formatTimer(item.timer.duration) })}
        </span>
      ) : null}

      {canEdit ? (
        <Button variant="ghost" size="icon" className="size-8" aria-label={t("sets.removeSong", { title })} onClick={onRemove}>
          <X />
        </Button>
      ) : null}
    </li>
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
